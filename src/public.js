// Public web flows: key request + lost-key recovery.
//
// Both are unauthenticated by design, so they are defended with:
//   * per-IP and per-email rate limiting (D1-backed, see db.js);
//   * no-enumeration responses (recover never reveals whether an address
//     exists — it always says "if we have a record, we've emailed you");
//   * minimal validation and HTML escaping throughout.
//
// Auto-issue is IDEMPOTENT: one active key per (email, domain, plugin). A
// repeat request re-sends the existing key instead of minting a duplicate.
// This keeps key/site accounting clean ahead of any future enforcement.

import { getProduct, PRODUCTS } from './products.js';
import { generateKey } from './keys.js';
import { normaliseDomain } from './telemetry.js';
import { shell, esc } from './theme.js';
import {
  insertLicense,
  insertRequest,
  getLicensesByEmail,
  findExistingLicense,
  countRecent,
  recordRateEvent,
} from './db.js';
import { sendKeyEmail, sendLostKeyEmail, sendAdminNotice } from './email.js';

// Rate-limit policy (per rolling hour).
const LIMIT_PER_IP_HOUR = 10;
const LIMIT_PER_EMAIL_HOUR = 5;
const HOUR = 3600;
const DAY = 86400;

/**
 * Handler: /request (GET = form, POST = submit).
 *
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleRequestForm(request, env, ctx) {
  if (request.method === 'GET') {
    // Support deep-linking from a plugin's Licence screen, e.g.
    //   /request?plugin=dawesome-name-generator&domain=example.com
    // Pre-fills the form so the user only has to supply their email.
    return html(requestPage(env, { values: queryValues(request) }));
  }
  if (request.method !== 'POST') {
    return html(requestPage(env, { error: 'Method not allowed.' }), 405);
  }

  const form = await readForm(request);
  const email = cleanEmail(form.email);
  const domain = normaliseDomain(form.domain);
  const plugin = (form.plugin || '').trim();
  const name = (form.name || '').trim().slice(0, 120) || null;

  const errors = [];
  if (!email) errors.push('A valid email address is required.');
  if (!domain || !/\./.test(domain)) errors.push('A valid domain (e.g. example.com) is required.');
  if (!getProduct(plugin)) errors.push('Please choose a plugin.');

  if (errors.length) {
    return html(requestPage(env, { error: errors.join(' '), values: { email, domain, plugin, name } }), 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const country = request.headers.get('CF-IPCountry') || null;

  const limited = await rateLimited(env, ip, email, nowSec);
  if (limited) {
    return html(requestPage(env, { error: 'Too many requests. Please try again later.' }), 429);
  }

  // Idempotent auto-issue: reuse an existing key for this (email, domain, plugin).
  let key;
  let resent = false;
  const existing = await findExistingLicense(env, email, domain, plugin);
  if (existing) {
    key = existing.key;
    resent = true;
  } else {
    key = generateKey(plugin);
    await insertLicense(env, {
      key,
      email,
      name,
      products: [plugin],
      status: 'active',
      expires: null,
      mode: 'observe',
      max_sites: null,
      created_at: nowSec,
      domains: { [domain]: { first_seen: nowSec, last_seen: nowSec } },
    });
  }

  await insertRequest(env, {
    email,
    name,
    domain,
    plugin,
    key,
    ip: ip || null,
    country,
    created_at: nowSec,
  });

  // Emails are best-effort and must not block the HTTP response.
  const baseUrl = envStr(env, 'UPDATE_BASE_URL', new URL(request.url).origin).replace(/\/+$/, '');
  const notify = envStr(env, 'NOTIFY_EMAIL', '');
  const mail = (async () => {
    await sendKeyEmail(env, { to: email, name, key, plugin, domain, baseUrl });
    if (notify) {
      await sendAdminNotice(env, notify, { email, name, domain, plugin, key, ip, country });
    }
  })();
  schedule(ctx, mail);

  return html(
    requestDonePage({ email, domain, plugin, resent, keyConfigured: !!(env && env.POSTMARK_TOKEN) })
  );
}

/**
 * Handler: /recover (GET = form, POST = submit).
 *
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleRecoverForm(request, env, ctx) {
  if (request.method === 'GET') {
    return html(recoverPage({}));
  }
  if (request.method !== 'POST') {
    return html(recoverPage({ error: 'Method not allowed.' }), 405);
  }

  const form = await readForm(request);
  const email = cleanEmail(form.email);
  if (!email) {
    return html(recoverPage({ error: 'A valid email address is required.' }), 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const limited = await rateLimited(env, ip, null, nowSec);
  if (limited) {
    return html(recoverPage({ error: 'Too many requests. Please try again later.' }), 429);
  }

  // Look up + email, but ALWAYS return the same page (no enumeration).
  const work = (async () => {
    try {
      const licenses = await getLicensesByEmail(env, email);
      const active = licenses.filter((l) => l.status === 'active');
      if (active.length) {
        await sendLostKeyEmail(env, {
          to: email,
          keys: active.map((l) => ({ key: l.key, products: l.products, domain: Object.keys(l.domains || {})[0] })),
        });
      }
    } catch (err) {
      console.error('recover: lookup/send failed:', err?.message || err);
    }
  })();
  schedule(ctx, work);

  return html(recoverDonePage({ email }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply per-IP + per-email rate limits, recording events on pass.
 *
 * @param {object} env
 * @param {string} ip
 * @param {string|null} email
 * @param {number} nowSec
 * @returns {Promise<boolean>} true when the request should be rejected.
 */
async function rateLimited(env, ip, email, nowSec) {
  const since = nowSec - HOUR;
  if (ip) {
    const n = await countRecent(env, `ip:${ip}`, since);
    if (n >= LIMIT_PER_IP_HOUR) return true;
  }
  if (email) {
    const n = await countRecent(env, `email:${email.toLowerCase()}`, since);
    if (n >= LIMIT_PER_EMAIL_HOUR) return true;
  }
  // Record on pass; prune anything older than a day opportunistically.
  if (ip) await recordRateEvent(env, `ip:${ip}`, nowSec, nowSec - DAY);
  if (email) await recordRateEvent(env, `email:${email.toLowerCase()}`, nowSec, nowSec - DAY);
  return false;
}

/**
 * Extract pre-fill values for the request form from the query string.
 *
 * Plugins deep-link to the form with a helpful hint about who they are, e.g.
 *   /request?plugin=dawesome-name-generator&domain=example.com&name=My%20Site
 * Nothing here is trusted — the POST handler validates it all again — but it
 * lets the form arrive populated so a user only has to type their email.
 *
 * @param {Request} request
 * @returns {{plugin?:string, domain?:string, name?:string, email?:string, ref?:string}}
 */
function queryValues(request) {
  const url = new URL(request.url);
  const pick = (k) => (url.searchParams.get(k) || '').trim().slice(0, 120);
  const values = {
    plugin: pick('plugin'),
    domain: pick('domain'),
    name: pick('name'),
    email: pick('email'),
    ref: pick('ref'),
  };
  // Drop empties so the template falls back to its own defaults.
  for (const k of Object.keys(values)) {
    if (!values[k]) delete values[k];
  }
  return values;
}

/**
 * Parse a form body (application/x-www-form-urlencoded or JSON).
 *
 * @param {Request} request
 * @returns {Promise<object>}
 */
async function readForm(request) {
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      const data = await request.json();
      return data && typeof data === 'object' ? data : {};
    }
    const text = await request.text();
    const params = new URLSearchParams(text);
    const out = {};
    for (const [k, v] of params) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Normalise and validate an email address.
 *
 * @param {string} s
 * @returns {string}
 */
function cleanEmail(s) {
  const v = String(s || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

/**
 * Run a promise in the background if an execution context is available.
 *
 * @param {ExecutionContext} [ctx]
 * @param {Promise<*>} p
 */
function schedule(ctx, p) {
  const guarded = p.catch((err) => console.error('background task failed:', err?.message || err));
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(guarded);
  }
}

/**
 * @param {object} env
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function envStr(env, name, fallback = '') {
  const v = env?.[name];
  return typeof v === 'string' && v !== '' ? v : fallback;
}

// ---------------------------------------------------------------------------
// HTML rendering (intentionally dependency-free; escaped by default)
// ---------------------------------------------------------------------------

/**
 * @param {string} body
 * @param {number} [status]
 * @returns {Response}
 */
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * @param {object} env
 * @param {object} o
 * @returns {string}
 */
function requestPage(env, { error, values = {} } = {}) {
  const products = productOptions(values.plugin);
  const fromPlugin = values.ref
    ? `<div class="alert alert--info">Opened from your <strong>${esc(values.ref)}</strong> plugin &mdash; the details below were filled in for you.</div>`
    : '';
  const body = `
    <div class="page-head">
      <h1>Request a licence key</h1>
      <p>Enter your details and we'll email you a licence key for your site.</p>
    </div>
    <div class="card">
      <div class="card__body">
        ${error ? `<div class="alert alert--err">${esc(error)}</div>` : ''}
        ${fromPlugin}
        <form method="post" action="/request">
          <label for="email">Email <span class="req">*</span></label>
          <input id="email" name="email" type="email" required value="${esc(values.email || '')}">

          <label for="domain">Domain <span class="req">*</span></label>
          <input id="domain" name="domain" type="text" required placeholder="example.com"
                 value="${esc(values.domain || '')}">
          <div class="hint">The site where the plugin is installed, without http:// or www.</div>

          <label for="plugin">Plugin <span class="req">*</span></label>
          <select id="plugin" name="plugin" required>${products}</select>

          <label for="name">Name</label>
          <input id="name" name="name" type="text" value="${esc(values.name || '')}">
          <div class="hint">Optional.</div>

          <div class="btn-row">
            <button class="btn" type="submit">Request key</button>
          </div>
        </form>
      </div>
    </div>`;
  return shell({ title: 'Request a licence key', body, wrapClass: 'wrap--narrow' });
}

/**
 * @param {object} o
 * @returns {string}
 */
function requestDonePage({ email, domain, plugin, resent }) {
  const intro = resent
    ? `You already have a key for <strong>${esc(plugin)}</strong> on <strong>${esc(domain)}</strong>. We've re-sent it to you.`
    : `Thanks! A licence key for <strong>${esc(plugin)}</strong> on <strong>${esc(domain)}</strong> is on its way.`;
  const body = `
    <div class="page-head"><h1>Check your email</h1></div>
    <div class="card">
      <div class="card__body">
        <div class="alert alert--ok">${intro}</div>
        <p>Look out for an email at <strong>${esc(email)}</strong>. If it doesn't arrive within a few
           minutes, check your spam folder.</p>
        <p class="muted">Lost it already? You can always retrieve it from the
           <a href="/recover">key recovery page</a>.</p>
      </div>
    </div>`;
  return shell({ title: 'Check your email', body, wrapClass: 'wrap--narrow' });
}

/**
 * @param {object} o
 * @returns {string}
 */
function recoverPage({ error } = {}) {
  const body = `
    <div class="page-head">
      <h1>Recover your licence key</h1>
      <p>Enter the email address you used when requesting your key.</p>
    </div>
    <div class="card">
      <div class="card__body">
        ${error ? `<div class="alert alert--err">${esc(error)}</div>` : ''}
        <p>If we have a key on file, we'll email it to you.</p>
        <form method="post" action="/recover">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required>
          <div class="btn-row">
            <button class="btn" type="submit">Email my key(s)</button>
          </div>
        </form>
        <p class="hint">For your security we don't display keys on this page &mdash; they're only
           ever emailed to the address on file.</p>
      </div>
    </div>`;
  return shell({ title: 'Recover your licence key', body, wrapClass: 'wrap--narrow' });
}

/**
 * @param {object} o
 * @returns {string}
 */
function recoverDonePage({ email }) {
  const body = `
    <div class="page-head"><h1>Check your email</h1></div>
    <div class="card">
      <div class="card__body">
        <div class="alert alert--ok">If we have a licence key on file for
          <strong>${esc(email)}</strong>, we've emailed it to that address.</div>
        <p class="muted">Don't forget to check your spam folder.</p>
      </div>
    </div>`;
  return shell({ title: 'Check your email', body, wrapClass: 'wrap--narrow' });
}

/**
 * @param {string} [selected]
 * @returns {string}
 */
function productOptions(selected) {
  return Object.keys(PRODUCTS)
    .map((slug) => `<option value="${esc(slug)}"${slug === selected ? ' selected' : ''}>${esc(slug)}</option>`)
    .join('');
}
