// Licence store lookup.
//
// Authoritative store is now D1 (see db.js / schema.sql). The legacy static
// JSON LICENSE_STORE secret is still honoured as a fallback so the server
// keeps validating keys during the migration window. Swapping/adding a backing
// store later touches this module and db.js only.
//
// Record shape (single source of truth):
//
//   {
//     products: ["dawesome-name-generator"],  // or ["*"] for all
//     status:   "active",
//     expires:  null | "YYYY-MM-DD",
//     mode:     "observe" | "enforce",        // enforcement is a later phase
//     max_sites: null | number,               // null = unlimited
//     domains:  { "example.com": { first_seen, last_seen } }
//   }
//
// `mode`/`max_sites`/`domains` are consulted only when a record's `mode` is
// `"enforce"`. In the default `"observe"` mode the key works on any site and
// the per-domain data is recorded for insight only. See checkDomain(), which
// is the single branch that turns enforcement on.

import { getProduct } from './products.js';
import { getLicense } from './db.js';
import { normaliseDomain } from './telemetry.js';

/**
 * Parse the raw licence store (already JSON text).
 *
 * @param {string|object|null} raw
 * @returns {object} key => record
 */
export function parseStore(raw) {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Does a licence record unlock a given product?
 *
 * @param {object} record
 * @param {string} product
 * @returns {boolean}
 */
export function recordUnlocksProduct(record, product) {
  if (!record || !Array.isArray(record.products)) {
    return false;
  }
  return record.products.includes('*') || record.products.includes(product);
}

/**
 * Is a licence record currently usable?
 *
 * @param {object} record
 * @param {number} [nowSec]
 * @returns {boolean}
 */
export function recordIsActive(record, nowSec = Math.floor(Date.now() / 1000)) {
  if (!record || record.status !== 'active') {
    return false;
  }
  if (record.expires) {
    const exp = Date.parse(record.expires + 'T23:59:59Z');
    if (!Number.isNaN(exp) && nowSec > Math.floor(exp / 1000)) {
      return false;
    }
  }
  return true;
}

/**
 * Enforce a licence's site (domain) binding, when the record opts in.
 *
 * This is the single branch that turns domain locking on. It is a pure
 * function so it can be unit-tested without D1.
 *
 * Policy (default is `observe`, i.e. no restriction):
 *   * mode !== 'enforce'            -> allow (telemetry-only record).
 *   * max_sites is null/<=0         -> allow (unlimited sites).
 *   * no domain supplied            -> reject `site_required` (we cannot bind).
 *   * domain already bound to key   -> allow.
 *   * key under its max_sites limit -> allow (already-bound domains).
 *   * otherwise                     -> reject `site_mismatch`.
 *
 * "Binding" here means the domain already appears in `record.domains` (a
 * domain may be pre-bound by the operator at issue/recovery time, in which
 * case first_seen/last_seen already exist). Enforcement never *adds* a
 * binding — that stays the job of telemetry/admin, so a leaked key cannot
 * claim a fresh site just by calling /v1/update first.
 *
 * @param {object} record
 * @param {string} site Raw `site` query value (e.g. "https://example.com/").
 * @returns {{ ok: true } | { ok: false, error: string, message: string }}
 */
export function checkDomain(record, site) {
  const mode = record?.mode || 'observe';
  if (mode !== 'enforce') {
    return { ok: true };
  }

  const max = record.max_sites;
  if (max == null || Number(max) <= 0) {
    return { ok: true };
  }

  const domain = normaliseDomain(site);
  if (!domain) {
    return {
      ok: false,
      error: 'site_required',
      message: 'This licence is locked to a site. Update with the site URL to continue.',
    };
  }

  const bound = Object.keys(record.domains || {});
  if (bound.includes(domain)) {
    return { ok: true };
  }

  if (bound.length < Number(max)) {
    // Room to add this domain — but binding only happens via telemetry or the
    // operator, so a brand-new domain is not auto-claimed here.
    return {
      ok: false,
      error: 'site_mismatch',
      message: 'This licence is not valid for this site.',
    };
  }

  return {
    ok: false,
    error: 'site_mismatch',
    message: 'This licence is already in use on the maximum number of sites.',
  };
}

/**
 * Pure validation of an already-resolved record against a product.
 *
 * @param {object|null} record
 * @param {string} product
 * @param {number} nowSec
 * @param {string|null} [site] Raw `site` query value; enforced only in 'enforce' mode.
 * @returns {{ ok: true } | { ok: false, error: string, message: string }}
 */
export function validateRecord(record, product, nowSec, site = null) {
  if (!record) {
    return {
      ok: false,
      error: 'invalid_license',
      message: 'This licence key is not valid.',
    };
  }
  if (!recordUnlocksProduct(record, product)) {
    return {
      ok: false,
      error: 'license_product_mismatch',
      message: 'This licence key does not include this product.',
    };
  }
  if (!recordIsActive(record, nowSec)) {
    return {
      ok: false,
      error: 'license_expired',
      message: 'This licence key has expired or is inactive.',
    };
  }
  // Domain lock (only active when the record opts in via mode:'enforce').
  return checkDomain(record, site);
}

/**
 * Async licence lookup: D1 first, then the legacy JSON secret.
 *
 * @param {string} key
 * @param {string} product
 * @param {object} env      Worker env (needs DB binding + optional LICENSE_STORE).
 * @param {number} [nowSec]
 * @param {string|null} [site] Raw `site` query value; enforced only in 'enforce' mode.
 * @returns {Promise<{ ok: true } | { ok: false, error: string, message: string }>}
 */
export async function lookupLicenseAsync(key, product, env, nowSec = Math.floor(Date.now() / 1000), site = null) {
  if (!key || typeof key !== 'string') {
    return { ok: false, error: 'invalid_license', message: 'A licence key is required.' };
  }
  if (!getProduct(product)) {
    return { ok: false, error: 'unknown_product', message: 'Unknown product.' };
  }

  const trimmed = key.trim();

  // 1) D1 (authoritative once populated).
  let record = null;
  try {
    record = await getLicense(env, trimmed);
  } catch (err) {
    console.error('licenses: D1 lookup failed:', err?.message || err);
  }

  // 2) Legacy JSON secret fallback.
  if (!record) {
    const store = parseStore(env?.LICENSE_STORE);
    record = store[trimmed] || null;
  }

  return validateRecord(record, product, nowSec, site);
}

/**
 * Validate a licence key against a product (legacy synchronous API).
 *
 * Kept for backwards compatibility with existing tests/callers that pass a
 * raw store object. New code should use lookupLicenseAsync().
 *
 * @param {string} key      Submitted licence key.
 * @param {string} product  Product slug.
 * @param {string|object} storeRaw Raw LICENSE_STORE.
 * @param {number} [nowSec]
 * @returns {{ ok: true } | { ok: false, error: string, message: string }}
 */
export function lookupLicense(key, product, storeRaw, nowSec = Math.floor(Date.now() / 1000)) {
  if (!key || typeof key !== 'string') {
    return { ok: false, error: 'invalid_license', message: 'A licence key is required.' };
  }

  // Unknown product is checked by the caller; guard anyway.
  if (!getProduct(product)) {
    return { ok: false, error: 'unknown_product', message: 'Unknown product.' };
  }

  const store = parseStore(storeRaw);
  const record = store[key.trim()];
  return validateRecord(record, product, nowSec);
}
