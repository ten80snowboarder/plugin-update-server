// Licence-key generation.
//
// Keys are product-prefixed so a key can be eyeballed back to its plugin:
//
//   DNG-XXXX-XXXX-XXXX   (dawesome-name-generator)
//   CFD-XXXX-XXXX-XXXX   (cfdump)
//
// Groups are drawn from Crockford-style base32 (alphabet without 0/O/1/I) so
// keys are unambiguous when read aloud or typed from a screen. The random
// source is crypto.getRandomValues, available in the Workers runtime.

import { getKeyPrefix } from './products.js';

// 32 symbols, ambiguity-free (no 0 O 1 I).
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const GROUP_LEN = 4;
const GROUP_COUNT = 3;

/**
 * Cryptographically-random indices in [0, max).
 *
 * @param {number} count
 * @param {number} max
 * @returns {number[]}
 */
function randomIndices(count, max) {
  // Rejection sampling to avoid modulo bias.
  const out = [];
  const limit = Math.floor(256 / max) * max;
  while (out.length < count) {
    const bytes = new Uint8Array(count - out.length);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) {
        out.push(b % max);
        if (out.length === count) break;
      }
    }
  }
  return out;
}

/**
 * Generate a random key body (without prefix), e.g. "A2B3-C4D5-E6F7".
 *
 * @returns {string}
 */
export function randomKeyBody() {
  const total = GROUP_LEN * GROUP_COUNT;
  const chars = randomIndices(total, ALPHABET.length).map((i) => ALPHABET[i]);
  const groups = [];
  for (let i = 0; i < total; i += GROUP_LEN) {
    groups.push(chars.slice(i, i + GROUP_LEN).join(''));
  }
  return groups.join('-');
}

/**
 * Generate a full product-prefixed licence key.
 *
 * @param {string} product    Product slug (determines the prefix).
 * @param {string} [prefixOverride] Optional explicit prefix.
 * @returns {string}          e.g. "DNG-A2B3-C4D5-E6F7".
 * @throws {Error}            If the product has no prefix and none is given.
 */
export function generateKey(product, prefixOverride = null) {
  const prefix = prefixOverride || getKeyPrefix(product);
  if (!prefix) {
    throw new Error(`No key prefix for product "${product}".`);
  }
  return `${prefix}-${randomKeyBody()}`;
}

/**
 * Loose structural check for a key (not a validity check).
 *
 * @param {string} key
 * @returns {boolean}
 */
export function looksLikeKey(key) {
  return typeof key === 'string' && /^[A-Z0-9]{2,6}(-[A-Z0-9]{4,6})+$/.test(key.trim().toUpperCase());
}
