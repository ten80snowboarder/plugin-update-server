// Public "latest download" endpoints.
//
// Unlike /v1/update (which needs a licence and returns a *short-lived signed*
// download URL for the private asset), these endpoints are deliberately open:
// anyone — e.g. a blog's Download button — can fetch the current release of a
// product without a licence.
//
// Rationale: the licence gates *updates* (server-mediated version delivery),
// not the plugin's functionality. The code is downloadable; a licence simply
// unlocks automatic updates. If we later gate functionality, that lives in the
// plugin, not here.
//
//   GET /v1/latest/:product        -> 302 redirect to a fresh signed download
//   GET /v1/latest/:product.zip    -> same (convenience for a Download button)
//   GET /v1/latest/:product/info   -> JSON { product, version, published_at,
//                                            download_url, requires... }
//
// The redirect target is the same signed, short-lived /v1/download/:token the
// plugin uses, so the private asset URL is never exposed and downloads stay
// cheap (served via GitHub's storage, not re-buffered here).

import { getProduct } from './products.js';
import { getLatestRelease, pickAsset } from './github.js';
import { createToken } from './sign.js';
import { json, softFail, hardFail } from './responses.js';

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
 * Resolve a product's latest release into a signed download URL.
 *
 * @param {object} env
 * @param {string} productSlug
 * @param {string} origin  Request origin, used if UPDATE_BASE_URL is unset.
 * @returns {Promise<
 *   { ok: true, version: string, publishedAt: string, downloadUrl: string, product: object }
 *   | { ok: false, status: number, error: string, message: string }
 * >}
 */
async function resolveLatest(env, productSlug, origin) {
  const product = getProduct(productSlug);
  if (!product) {
    return { ok: false, status: 404, error: 'unknown_product', message: `No product registered for "${productSlug}".` };
  }

  const token = envStr(env, 'GITHUB_TOKEN');
  if (!token) {
    return { ok: false, status: 500, error: 'upstream_error', message: 'Server is not configured with a GitHub token.' };
  }

  const result = await getLatestRelease(product.repo, token);
  if (!result.ok) {
    if (result.status === 404) {
      return { ok: false, status: 404, error: 'no_release', message: 'The product has no published release yet.' };
    }
    return { ok: false, status: 502, error: 'upstream_error', message: result.message };
  }

  const release = result.release;
  const asset = pickAsset(release, product.asset_pattern || null);
  if (!asset) {
    return { ok: false, status: 404, error: 'no_release', message: 'The latest release has no downloadable zip asset.' };
  }

  const signingSecret = envStr(env, 'SIGNING_SECRET');
  if (!signingSecret) {
    return { ok: false, status: 500, error: 'upstream_error', message: 'Server is not configured with a signing secret.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = parseInt(envStr(env, 'DOWNLOAD_TTL', '300'), 10) || 300;
  const baseUrl = envStr(env, 'UPDATE_BASE_URL', origin).replace(/\/+$/, '');

  const signed = await createToken(
    { product: productSlug, asset_id: asset.id, asset_url: asset.url, exp: nowSec + ttl },
    signingSecret
  );

  const version = String(release.tag_name || '').replace(/^v/i, '') || release.name || '';
  const publishedAt = release.published_at ? release.published_at.replace('T', ' ').replace('Z', '') : '';

  return {
    ok: true,
    product,
    version,
    publishedAt,
    downloadUrl: `${baseUrl}/v1/download/${signed}`,
  };
}

/**
 * Handler: GET /v1/latest/:product[/info|.zip]
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} rest  The path segment after /v1/latest/ (e.g. "cfdump" or "cfdump/info").
 * @returns {Promise<Response>}
 */
export async function handleLatest(request, env, rest) {
  const origin = new URL(request.url).origin;

  // Split "cfdump/info" or "cfdump.zip".
  const [head, ...tail] = String(rest || '').split('/').filter(Boolean);
  const wantsInfo = tail[0] === 'info';
  const slug = head.replace(/\.zip$/i, '');

  if (!slug) {
    return softFail('missing_params', 'A product slug is required, e.g. /v1/latest/cfdump');
  }

  const resolved = await resolveLatest(env, slug, origin);
  if (!resolved.ok) {
    return hardFail(resolved.status, resolved.error, resolved.message);
  }

  if (wantsInfo) {
    return json({
      product: slug,
      version: resolved.version,
      published_at: resolved.publishedAt,
      download_url: resolved.downloadUrl,
      homepage: resolved.product.homepage || '',
      requires: resolved.product.requires || '',
      tested: resolved.product.tested || '',
      requires_php: resolved.product.requires_php || '',
    });
  }

  // A real 302 to the signed asset URL: the blog's Download button just links
  // here, and the browser follows the redirect.
  return new Response(null, {
    status: 302,
    headers: {
      location: resolved.downloadUrl,
      'cache-control': 'no-store',
    },
  });
}
