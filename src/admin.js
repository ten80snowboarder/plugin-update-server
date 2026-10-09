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
import { shell, esc } from './theme.js';
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

  const tiles = `
    <div class="tiles">
      ${tile('Licences issued', data.installs)}
      ${tile(`Active sites (${days}d)`, data.active_sites)}
      ${tile('Plugins', data.by_plugin.length)}
      ${tile('Countries', data.by_country.length)}
    </div>`;

  const pluginRows = data.by_plugin
    .map((r) => `<tr><td>${esc(r.plugin)}</td><td>${r.sites}</td><td>${r.checkins}</td></tr>`)
    .join('');

  const countryRows = data.by_country
    .map((r) => `<tr><td>${esc(r.country || '??')}</td><td>${r.sites}</td></tr>`)
    .join('');

  const versionRows = data.by_version
    .map((r) => `<tr><td>${esc(r.plugin)}</td><td><span class="badge badge--muted">${esc(r.version || '')}</span></td><td>${r.sites}</td></tr>`)
    .join('');

  const domainRows = data.by_domain
    .map((r) => {
      const plugins = String(r.plugins || '').split(',').filter(Boolean).map(esc).join(', ');
      const versions = String(r.versions || '').split(',').filter(Boolean).map(esc).join(', ');
      return `<tr>
        <td class="mono">${esc(r.domain)}</td>
        <td>${plugins || '<em class="muted">&mdash;</em>'}</td>
        <td>${versions || '<em class="muted">&mdash;</em>'}</td>
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
      const status = String(l.status || '');
      const statusBadge = status === 'active'
        ? `<span class="badge badge--ok">active</span>`
        : `<span class="badge badge--off">${esc(status || 'unknown')}</span>`;
      const mode = String(l.mode || 'observe');
      const modeBadge = mode === 'enforce'
        ? `<span class="badge badge--brand">enforce</span>`
        : `<span class="badge badge--muted">observe</span>`;
      return `<tr>
        <td><span class="keycell">${esc(l.key)}</span></td>
        <td>${esc(l.email)}</td>
        <td>${esc(l.name || '')}</td>
        <td>${esc((l.products || []).join(', '))}</td>
        <td>${statusBadge}</td>
        <td>${modeBadge}</td>
        <td>${l.max_sites == null ? '<span class="muted">unlimited</span>' : l.max_sites}</td>
        <td>${domains.length ? domains.map(esc).join('<br>') : '<em class="muted">none yet</em>'}</td>
      </tr>`;
    })
    .join('');

  const table = (head, rows, cols) => `
    <div class="table-wrap">
      <table><thead><tr>${head}</tr></thead>
      <tbody>${rows || `<tr><td class="empty" colspan="${cols}">No data yet.</td></tr>`}</tbody></table>
    </div>`;

  const body = `
    <div class="page-head">
      <h1>Plugin usage</h1>
      <p>Generated ${new Date(nowSec * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC</p>
    </div>

    <div class="alert alert--info">
      Customer self-service forms:
      <a href="/request" target="_blank" rel="noopener">Request a licence key &rarr;</a>
      &middot;
      <a href="/recover" target="_blank" rel="noopener">Recover a lost key &rarr;</a>
    </div>

    <div class="stack">
      ${tiles}

      <div class="card">
        <div class="card__head">Installs by plugin</div>
        ${table('<th>Plugin</th><th>Sites</th><th>Check-ins</th>', pluginRows, 3)}
      </div>

      <div class="card">
        <div class="card__head">Sites by domain</div>
        ${table('<th>Domain</th><th>Plugins</th><th>Versions</th><th>Country</th><th>First seen</th><th>Last seen</th><th>Check-ins</th>', domainRows, 7)}
      </div>

      <div class="card">
        <div class="card__head">Sites by country</div>
        ${table('<th>Country</th><th>Sites</th>', countryRows, 2)}
      </div>

      <div class="card">
        <div class="card__head">Sites by version</div>
        ${table('<th>Plugin</th><th>Version</th><th>Sites</th>', versionRows, 3)}
      </div>

      <div class="card">
        <div class="card__head">Licences <span class="count">${licenses.length}</span></div>
        ${table('<th>Key</th><th>Email</th><th>Name</th><th>Products</th><th>Status</th><th>Mode</th><th>Max sites</th><th>Domains seen</th>', licenseRows, 8)}
      </div>
    </div>`;

  const actions = `<form method="post" action="/admin/logout">
    <button class="btn btn--ghost" type="submit">Sign out</button>
  </form>`;

  return shell({ title: 'Plugin Usage — Admin', body, actions });
}

/**
 * @param {object} o
 * @returns {string}
 */
function loginPage({ error } = {}) {
  const body = `
    <div class="page-head"><h1>Admin sign in</h1></div>
    <div class="card">
      <div class="card__body">
        ${error ? `<div class="alert alert--err">${esc(error)}</div>` : ''}
        <p class="muted">Enter your admin token to continue.</p>
        <form method="post" action="/admin/login">
          <label for="token">Admin token</label>
          <input id="token" name="token" type="password" autocomplete="current-password" required autofocus>
          <div class="btn-row"><button class="btn btn--block" type="submit">Sign in</button></div>
        </form>
      </div>
    </div>`;
  return shell({ title: 'Admin sign in', body, wrapClass: 'wrap--narrow' });
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
function tile(label, value) {
  return `<div class="tile"><div class="tile__n">${Number(value) || 0}</div><div class="tile__l">${esc(label)}</div></div>`;
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
