// Cloudflare Worker entry point / router.
//
// Public API (consumed by the WP plugin):
//   GET /v1/health
//   GET /v1/update?plugin=...&license=...&version=...&php=...&wp=...&site=...
//   GET /v1/download/:token
//
// Public API (no licence — for blogs / direct downloads):
//   GET /v1/latest/:product        -> 302 to the current release zip
//   GET /v1/latest/:product.zip    -> same (convenient for a Download button)
//   GET /v1/latest/:product/info   -> JSON { version, published_at, download_url, ... }
//
// Public web flows (consumed by humans):
//   GET  /request        key request form
//   POST /request        submit a key request (auto-issue + email)
//   GET  /recover        lost-key form
//   POST /recover        email all keys on file for an address
//
// Operator-only (guarded by ADMIN_TOKEN):
//   GET /admin                 dashboard (HTML)
//   GET /v1/admin/summary      aggregates (JSON)
//   GET /v1/admin/licenses     all licences (JSON)
//
// See CONTRACT.md for the JSON shapes.

import { getProduct } from './products.js';
import { lookupLicense, lookupLicenseAsync } from './licenses.js';
import { getLatestRelease, pickAsset, downloadAsset } from './github.js';
import { createToken, verifyToken, isFresh } from './sign.js';
import { json, softFail, hardFail, corsHeaders } from './responses.js';
import { recordCheckin } from './telemetry.js';
import { handleLatest } from './latest.js';
import { handleRequestForm, handleRecoverForm } from './public.js';
import {
  handleAdminPage,
  handleAdminSummary,
  handleAdminLicenses,
  handleAdminLogin,
  handleAdminLogout,
} from './admin.js';

/**
 * Read an env var with a default.
 *
 * @param {object} env
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function envStr(env, name, fallback = '') {
  const v = env?.[name];
  return typeof v === 'string' && v !== '' ? v : fallback;
}

/**
 * Convert GitHub's release body (markdown) to a tiny HTML changelog.
 * We keep it deliberately minimal and escape everything.
 *
 * @param {string} body
 * @returns {string}
 */
function changelogHtml(body) {
  const text = typeof body === 'string' ? body : '';
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = esc.split('\n').map((l) => l.trim());
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (!line) continue;

    // Skip the generic "== Changelog ==" heading; we supply our own.
    if (/^==\s*Changelog\s*==$/i.test(line)) continue;

    // Version heading, e.g. "= 0.1.2 =" (but not a top-level "== ... ==").
    const version = line.match(/^=\s*(.+?)\s*=$/);
    if (version) {
      closeList();
      out.push(`<h4>${version[1]}</h4>`);
      continue;
    }

    // Bullet item, e.g. "* Something" or "- Something".
    const bullet = line.match(/^[-*]\s*(.+)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${bullet[1]}</li>`);
      continue;
    }

    // Any other line (e.g. a plain paragraph) renders as-is.
    closeList();
    out.push(`<p>${line}</p>`);
  }
  closeList();

  return `<h4>Changelog</h4>${out.join('')}`;
}

/**
 * Handler: GET /v1/update
 *
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleUpdate(request, env, ctx) {
  const url = new URL(request.url);
  const plugin = url.searchParams.get('plugin') || '';
  const license = url.searchParams.get('license') || '';
  const site = url.searchParams.get('site') || null;

  if (!plugin || !license) {
    return softFail('missing_params', 'Both "plugin" and "license" are required.');
  }

  const product = getProduct(plugin);
  if (!product) {
    return softFail('unknown_product', `No product registered for "${plugin}".`);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // `site` is passed so the licence lookup can enforce a domain lock when the
  // record's mode is 'enforce'. In the default 'observe' mode it is ignored.
  const check = await lookupLicenseAsync(license, plugin, env, nowSec, site);
  if (!check.ok) {
    return softFail(check.error, check.message);
  }

  // Fire-and-forget telemetry. Must never delay or fail the response.
  const telemetry = recordCheckin(env, {
    license,
    plugin,
    version: url.searchParams.get('version') || null,
    site,
    country: request.headers.get('CF-IPCountry') || null,
    nowSec,
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(telemetry);
  } else {
    // No execution context (e.g. unit tests): don't await it either.
    telemetry.catch(() => {});
  }

  const token = envStr(env, 'GITHUB_TOKEN');
  if (!token) {
    return hardFail(500, 'upstream_error', 'Server is not configured with a GitHub token.');
  }

  const result = await getLatestRelease(product.repo, token);
  if (!result.ok) {
    if (result.status === 404) {
      return softFail('no_release', 'The product has no published release yet.');
    }
    return hardFail(502, 'upstream_error', result.message);
  }

  const release = result.release;
  const asset = pickAsset(release, product.asset_pattern || null);
  if (!asset) {
    return softFail('no_release', 'The latest release has no downloadable zip asset.');
  }

  const signingSecret = envStr(env, 'SIGNING_SECRET');
  if (!signingSecret) {
    return hardFail(500, 'upstream_error', 'Server is not configured with a signing secret.');
  }

  const ttl = parseInt(envStr(env, 'DOWNLOAD_TTL', '300'), 10) || 300;
  const baseUrl = envStr(env, 'UPDATE_BASE_URL', url.origin).replace(/\/+$/, '');

  // The signed token carries the asset's API url so /download can fetch it
  // without a second lookup. Asset URLs are already authenticated API URLs,
  // safe to embed inside the (opaque, signed, short-lived) token.
  const signed = await createToken(
    { product: plugin, asset_id: asset.id, asset_url: asset.url, exp: nowSec + ttl },
    signingSecret
  );

  const version = String(release.tag_name || '').replace(/^v/i, '') || release.name || '';
  const body = typeof release.body === 'string' ? release.body : '';

  return json({
    valid: true,
    product: plugin,
    version,
    download_url: `${baseUrl}/v1/download/${signed}`,
    homepage: product.homepage || '',
    requires: product.requires || '',
    tested: product.tested || '',
    requires_php: product.requires_php || '',
    last_updated: release.published_at ? release.published_at.replace('T', ' ').replace('Z', '') : '',
    changelog: body,
    sections: {
      description: product.description || '',
      changelog: changelogHtml(body),
    },
  });
}

/**
 * Handler: GET /v1/download/:token
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} tokenStr
 * @returns {Promise<Response>}
 */
export async function handleDownload(request, env, tokenStr) {
  const signingSecret = envStr(env, 'SIGNING_SECRET');
  if (!signingSecret) {
    return hardFail(500, 'upstream_error', 'Server is not configured.');
  }

  const payload = await verifyToken(tokenStr, signingSecret);
  if (!payload) {
    return hardFail(403, 'bad_token', 'This download link is not valid.');
  }
  if (!isFresh(payload)) {
    return hardFail(403, 'expired_token', 'This download link has expired. Please try updating again.');
  }

  const token = envStr(env, 'GITHUB_TOKEN');
  if (!token) {
    return hardFail(500, 'upstream_error', 'Server is not configured with a GitHub token.');
  }

  const assetUrl = payload.asset_url;
  if (typeof assetUrl !== 'string') {
    return hardFail(403, 'bad_token', 'This download link is not valid.');
  }

  const result = await downloadAsset(assetUrl, token);
  if (!result.ok) {
    return hardFail(502, 'upstream_error', result.message);
  }

  const filename = `${payload.product}.zip`;
  return new Response(result.response.body, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/**
 * Route a request to the correct handler.
 *
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} [ctx]
 * @returns {Promise<Response>}
 */
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let response;

  // --- Public web flows (GET form, POST submit) -------------------------
  if (path === '/request') {
    response = await handleRequestForm(request, env, ctx);
  } else if (path === '/recover') {
    response = await handleRecoverForm(request, env, ctx);

    // --- Operator-only routes -------------------------------------------
  } else if (path === '/admin' && method === 'GET') {
    response = await handleAdminPage(request, env);
  } else if (path === '/admin/login' && method === 'POST') {
    response = await handleAdminLogin(request, env);
  } else if (path === '/admin/logout' && method === 'POST') {
    response = handleAdminLogout(request, env);
  } else if (path === '/v1/admin/summary') {
    response = await handleAdminSummary(request, env);
  } else if (path === '/v1/admin/licenses') {
    response = await handleAdminLicenses(request, env);

    // --- Public API (WP plugin) -----------------------------------------
  } else if (method !== 'GET') {
    response = hardFail(405, 'method_not_allowed', 'Only GET is supported.');
  } else if (path === '/v1/health') {
    response = json({ ok: true, time: Math.floor(Date.now() / 1000) });
  } else if (path === '/v1/update') {
    response = await handleUpdate(request, env, ctx);
  } else if (path.startsWith('/v1/latest/')) {
    response = await handleLatest(request, env, path.slice('/v1/latest/'.length), ctx);
  } else if (path.startsWith('/v1/download/')) {
    response = await handleDownload(request, env, path.slice('/v1/download/'.length));
  } else {
    response = hardFail(404, 'not_found', 'Unknown endpoint.');
  }

  // Attach CORS headers (relevant for browser testing only). HTML pages set
  // their own content-type; we only merge CORS so we never clobber it.
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Worker entrypoint.
 *
 * Exported as a module `{ fetch }` object rather than a bare default function:
 * with newer Wrangler/runtime versions a *named* default export can be
 * mis-detected as a class-based (RPC) entrypoint, which fails with
 * "Class extends value ... is not a constructor". The object form is
 * unambiguous.
 */
export default {
  fetch(request, env, ctx) {
    return route(request, env, ctx);
  },
};

