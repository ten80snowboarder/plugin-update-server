// Licence store lookup.
//
// Phase 1 backing store: a static JSON map supplied as the LICENSE_STORE
// secret. Shape:
//
//   {
//     "DNG-AAAA-BBBB-CCCC": {
//       "products": ["dawesome-name-generator"],  // or ["*"] for all
//       "status": "active",
//       "expires": null | "YYYY-MM-DD"
//     }
//   }
//
// This module is the single seam for swapping in a KV / DB / Freemius-backed
// store later: callers only ever use lookupLicense().

import { getProduct } from './products.js';

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
 * Validate a licence key against a product.
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

  return { ok: true };
}
