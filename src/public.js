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
    return html(requestPage(env, {}));
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

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 34rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; font-size: .9rem; }
  input, select { width: 100%; box-sizing: border-box; padding: .55rem .7rem; font: inherit;
                  border: 1px solid #8886; border-radius: 8px; background: transparent; color: inherit; }
  .hint { font-size: .8rem; opacity: .7; margin-top: .25rem; }
  button { margin-top: 1.25rem; padding: .6rem 1.1rem; font: inherit; font-weight: 600;
           border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }
  .err { background: #dc2626 1a; border: 1px solid #dc2626; color: #dc2626;
         padding: .6rem .8rem; border-radius: 8px; margin: 1rem 0; }
  .ok { background: #16a34a 1a; border: 1px solid #16a34a; padding: .8rem 1rem;
        border-radius: 8px; margin: 1rem 0; }
  .key { font-family: ui-monospace, monospace; font-size: 1.05rem; background: #8882;
         padding: .5rem .7rem; border-radius: 8px; display: inline-block; margin: .3rem 0; }
  footer { margin-top: 2.5rem; opacity: .6; font-size: .8rem; }
`;

/**
 * @param {object} env
 * @param {object} o
 * @returns {string}
 */
function requestPage(env, { error, values = {} } = {}) {
  const products = productOptions(values.plugin);
  return page(
    'Request a licence key',
    `
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <p>Enter your details and we'll email you a licence key for your site.</p>
    <form method="post" action="/request">
      <label for="email">Email <span aria-hidden="true">*</span></label>
      <input id="email" name="email" type="email" required value="${esc(values.email || '')}">
      <label for="domain">Domain <span aria-hidden="true">*</span></label>
      <input id="domain" name="domain" type="text" required placeholder="example.com"
             value="${esc(values.domain || '')}">
      <div class="hint">The site where the plugin is installed, without http:// or www.</div>
      <label for="plugin">Plugin <span aria-hidden="true">*</span></label>
      <select id="plugin" name="plugin" required>${products}</select>
      <label for="name">Name</label>
      <input id="name" name="name" type="text" value="${esc(values.name || '')}">
      <div class="hint">Optional.</div>
      <button type="submit">Request key</button>
    </form>`
  );
}

/**
 * @param {object} o
 * @returns {string}
 */
function requestDonePage({ email, domain, plugin, resent }) {
  const intro = resent
    ? `You already have a key for <strong>${esc(plugin)}</strong> on <strong>${esc(domain)}</strong>. We've re-sent it to you.`
    : `Thanks! A licence key for <strong>${esc(plugin)}</strong> on <strong>${esc(domain)}</strong> is on its way.`;
  return page(
    'Check your email',
    `
    <div class="ok">${intro}</div>
    <p>Look out for an email at <strong>${esc(email)}</strong>. If it doesn't arrive within a few
       minutes, check your spam folder.</p>
    <p>Lost it already? You can always retrieve it from the
       <a href="/recover">key recovery page</a>.</p>`
  );
}

/**
 * @param {object} o
 * @returns {string}
 */
function recoverPage({ error } = {}) {
  return page(
    'Recover your licence key',
    `
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <p>Enter the email address you used when requesting your key. If we have a key on file,
       we'll email it to you.</p>
    <form method="post" action="/recover">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required>
      <button type="submit">Email my key(s)</button>
    </form>
    <p class="hint">For your security we don't display keys on this page — they're only ever
       emailed to the address on file.</p>`
  );
}

/**
 * @param {object} o
 * @returns {string}
 */
function recoverDonePage({ email }) {
  return page(
    'Check your email',
    `
    <div class="ok">If we have a licence key on file for <strong>${esc(email)}</strong>, we've
      emailed it to that address.</div>
    <p>Don't forget to check your spam folder.</p>`
  );
}

/**
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  ${body}
  <footer>ConnectBench · plugin licences &amp; updates</footer>
</body>
</html>`;
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

/**
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
