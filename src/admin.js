// Operator-only admin surface.
//
// Auth model:
//   * /v1/admin/*  — JSON, for scripting / curl. Accepts EITHER an
//                    `Authorization: Bearer <ADMIN_TOKEN>` header OR a valid
//                    session cookie.
//   * /admin       — the HTML dashboard. Uses a signed, HttpOnly session
//                    cookie. Unauthenticated visitors get a login form.
//
// The login form (POST /admin/login) checks the submitted value against
// ADMIN_TOKEN and sets a signed, time-limited cookie (see session.js). The
// admin token is never placed in a URL, history, bookmark or log.
//
// If ADMIN_TOKEN is unset, all admin routes are hard-disabled (503) rather
// than left open.

import { listLicenses, summary } from './db.js';
import { json, hardFail } from './responses.js';
import {
  createSession,
  verifySession,
  sessionSetCookie,
  sessionClearCookie,
  readCookie,
  SESSION_COOKIE,
} from './session.js';

/**
 * Constant-time-ish string compare.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Is the request authorised as an admin (bearer header or session cookie)?
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<boolean>}
 */
export async function isAdmin(request, env) {
  const expected = typeof env?.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  if (!expected) return false;

  // 1) Bearer header (curl / scripts).
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    if (safeEqual(auth.slice(7).trim(), expected)) return true;
  }

  // 2) Session cookie (browser dashboard).
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie && (await verifySession(env, cookie))) return true;

  return false;
}

/**
 * Authorise an admin JSON request, returning null when allowed or a Response.
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response|null>}
 */
export async function requireAdmin(request, env) {
  const expected = typeof env?.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  if (!expected) {
    return hardFail(503, 'admin_disabled', 'Admin access is not configured.');
  }
  if (!(await isAdmin(request, env))) {
    return hardFail(403, 'forbidden', 'A valid admin token is required.');
  }
  return null;
}

/**
 * GET /v1/admin/summary — aggregate usage JSON.
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleAdminSummary(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = parseInt(env?.ACTIVE_WINDOW || '2592000', 10) || 2592000;
  const data = await summary(env, nowSec - windowSec);
  return json({ ok: true, generated_at: nowSec, active_window: windowSec, ...data });
}

/**
 * GET /v1/admin/licenses — every licence record (JSON).
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleAdminLicenses(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const licenses = await listLicenses(env);
  return json({ ok: true, count: licenses.length, licenses });
}

/**
 * GET /admin — HTML dashboard, or the login form when not signed in.
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleAdminPage(request, env) {
  if (!env?.ADMIN_TOKEN) {
    return htmlPage(loginPage({ error: 'Admin access is not configured.' }), 503);
  }

  if (!(await isAdmin(request, env))) {
    return htmlPage(loginPage({}));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = parseInt(env?.ACTIVE_WINDOW || '2592000', 10) || 2592000;

  const [data, licenses] = await Promise.all([
    summary(env, nowSec - windowSec),
    listLicenses(env),
  ]);

  return htmlPage(renderDashboard({ data, licenses, windowSec, nowSec }));
}

/**
 * POST /admin/login — verify the admin token and start a session.
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleAdminLogin(request, env) {
  if (!env?.ADMIN_TOKEN) {
    return htmlPage(loginPage({ error: 'Admin access is not configured.' }), 503);
  }

  const form = await readForm(request);
  const submitted = (form.token || '').trim();
  if (!submitted || !safeEqual(submitted, env.ADMIN_TOKEN)) {
    return htmlPage(loginPage({ error: 'Incorrect token. Please try again.' }), 403);
  }

  const value = await createSession(env);
  if (!value) {
    return htmlPage(loginPage({ error: 'Could not start a session.' }), 500);
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: '/admin',
      'set-cookie': sessionSetCookie(value),
      'cache-control': 'no-store',
    },
  });
}

/**
 * POST /admin/logout — clear the session cookie.
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Response}
 */
export function handleAdminLogout(request, env) {
  return new Response(null, {
    status: 303,
    headers: {
      location: '/admin',
      'set-cookie': sessionClearCookie(),
      'cache-control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @returns {string}
 */
function renderDashboard({ data, licenses, windowSec, nowSec }) {
  const days = Math.round(windowSec / 86400);

  const statCards = `
    <div class="cards">
      ${card('Licences issued', data.installs)}
      ${card(`Active sites (${days}d)`, data.active_sites)}
      ${card('Plugins', data.by_plugin.length)}
      ${card('Countries', data.by_country.length)}
    </div>`;

  const pluginRows = data.by_plugin
    .map((r) => `<tr><td>${esc(r.plugin)}</td><td>${r.sites}</td><td>${r.checkins}</td></tr>`)
    .join('');

  const countryRows = data.by_country
    .map((r) => `<tr><td>${esc(r.country || '??')}</td><td>${r.sites}</td></tr>`)
    .join('');

  const versionRows = data.by_version
    .map((r) => `<tr><td>${esc(r.plugin)}</td><td>${esc(r.version || '')}</td><td>${r.sites}</td></tr>`)
    .join('');

  const domainRows = data.by_domain
    .map((r) => {
      const plugins = String(r.plugins || '').split(',').filter(Boolean).map(esc).join(', ');
      const versions = String(r.versions || '').split(',').filter(Boolean).map(esc).join(', ');
      return `<tr>
        <td class="mono">${esc(r.domain)}</td>
        <td>${plugins || '<em>&mdash;</em>'}</td>
        <td>${versions || '<em>&mdash;</em>'}</td>
        <td>${esc(r.country || '??')}</td>
        <td class="mono">${fmtTime(r.first_seen)}</td>
        <td class="mono">${fmtTime(r.last_seen)}</td>
        <td>${Number(r.checkins) || 0}</td>
      </tr>`;
    })
    .join('');

  const licenseRows = licenses
    .map((l) => {
      const domains = Object.keys(l.domains || {});
      return `<tr>
        <td class="mono">${esc(l.key)}</td>
        <td>${esc(l.email)}</td>
        <td>${esc(l.name || '')}</td>
        <td>${esc((l.products || []).join(', '))}</td>
        <td>${esc(l.status)}</td>
        <td>${esc(l.mode || 'observe')}</td>
        <td>${l.max_sites == null ? 'unlimited' : l.max_sites}</td>
        <td>${domains.length ? domains.map(esc).join('<br>') : '<em>none yet</em>'}</td>
      </tr>`;
    })
    .join('');

  return page(
    `<header>
      <h1>Plugin usage</h1>
      <form method="post" action="/admin/logout"><button class="ghost" type="submit">Sign out</button></form>
    </header>
    <p>Generated ${new Date(nowSec * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC</p>
    <p class="hint">Customer self-service forms:
      <a href="/request" target="_blank" rel="noopener">Request a licence key &rarr;</a>
      &middot;
      <a href="/recover" target="_blank" rel="noopener">Recover a lost key &rarr;</a>
    </p>
    ${statCards}

    <h2>Installs by plugin</h2>
    <table><thead><tr><th>Plugin</th><th>Sites</th><th>Check-ins</th></tr></thead>
    <tbody>${pluginRows || '<tr><td colspan="3"><em>No data yet.</em></td></tr>'}</tbody></table>

    <h2>Sites by domain</h2>
    <table><thead><tr>
      <th>Domain</th><th>Plugins</th><th>Versions</th><th>Country</th>
      <th>First seen</th><th>Last seen</th><th>Check-ins</th>
    </tr></thead>
    <tbody>${domainRows || '<tr><td colspan="7"><em>No data yet.</em></td></tr>'}</tbody></table>

    <h2>Sites by country</h2>
    <table><thead><tr><th>Country</th><th>Sites</th></tr></thead>
    <tbody>${countryRows || '<tr><td colspan="2"><em>No data yet.</em></td></tr>'}</tbody></table>

    <h2>Sites by version</h2>
    <table><thead><tr><th>Plugin</th><th>Version</th><th>Sites</th></tr></thead>
    <tbody>${versionRows || '<tr><td colspan="3"><em>No data yet.</em></td></tr>'}</tbody></table>

    <h2>Licences (${licenses.length})</h2>
    <table><thead><tr>
      <th>Key</th><th>Email</th><th>Name</th><th>Products</th>
      <th>Status</th><th>Mode</th><th>Max sites</th><th>Domains seen</th>
    </tr></thead>
    <tbody>${licenseRows || '<tr><td colspan="8"><em>No licences yet.</em></td></tr>'}</tbody></table>`
  );
}

/**
 * @param {object} o
 * @returns {string}
 */
function loginPage({ error } = {}) {
  return page(
    `<h1>Admin sign in</h1>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <p>Enter your admin token to continue.</p>
    <form method="post" action="/admin/login">
      <label for="token">Admin token</label>
      <input id="token" name="token" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Sign in</button>
    </form>`
  );
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 2rem; max-width: 1100px; margin-inline: auto; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1rem 1.25rem; min-width: 9rem; }
  .card .n { font-size: 1.8rem; font-weight: 600; }
  .card .l { opacity: .7; font-size: .8rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; font-size: .9rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8883; vertical-align: top; }
  th { font-weight: 600; opacity: .8; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { margin-top: 3rem; opacity: .6; font-size: .8rem; }
  form { margin: 1rem 0; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; font-size: .9rem; }
  input { width: 100%; max-width: 22rem; box-sizing: border-box; padding: .55rem .7rem;
          font: inherit; border: 1px solid #8886; border-radius: 8px; background: transparent; color: inherit; }
  button { margin-top: 1.25rem; padding: .55rem 1.1rem; font: inherit; font-weight: 600;
           border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }
  button.ghost { margin: 0; background: transparent; color: inherit; border: 1px solid #8886; }
  .hint { opacity: .7; font-size: .85rem; }
  .hint a { color: inherit; }
  .err { background: #dc2626 1a; border: 1px solid #dc2626; color: #dc2626;
         padding: .6rem .8rem; border-radius: 8px; margin: 1rem 0; max-width: 22rem; }
`;

/**
 * @param {string} body
 * @returns {string}
 */
function page(body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Plugin Usage — Admin</title>
<style>${STYLE}</style>
</head>
<body>
  ${body}
  <footer>ConnectBench · admin is session-protected · <code>noindex</code></footer>
</body>
</html>`;
}

/**
 * @param {string} body
 * @param {number} [status]
 * @returns {Response}
 */
function htmlPage(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * @param {string} label
 * @param {number} value
 * @returns {string}
 */
function card(label, value) {
  return `<div class="card"><div class="n">${Number(value) || 0}</div><div class="l">${esc(label)}</div></div>`;
}

/**
 * Parse a form body (urlencoded or JSON).
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
    const params = new URLSearchParams(await request.text());
    const out = {};
    for (const [k, v] of params) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} s
 * @returns {string}
 */
function fmtTime(unixSec) {
  const n = Number(unixSec);
  if (!n) return '\u2014';
  return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
