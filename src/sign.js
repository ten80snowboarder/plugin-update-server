// HMAC-signed, short-lived download tokens.
//
// A token is: base64url(payloadJson) + "." + base64url(HMAC_SHA256(payload, secret))
//
// The payload is { product, asset_id, exp }. Tokens are verified on the
// /v1/download route; an expired or tampered token is rejected. This keeps the
// private GitHub asset URL out of the client entirely.

/**
 * base64url-encode a Uint8Array or string.
 *
 * @param {Uint8Array|string} input
 * @returns {string}
 */
export function b64urlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url-decode to bytes.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
export function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Import an HMAC key.
 *
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Create a signed download token.
 *
 * @param {{product: string, asset_id: number, exp: number}} payload
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function createToken(payload, secret) {
  const body = b64urlEncode(JSON.stringify(payload));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify a signed token and return its payload.
 *
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<object|null>} payload, or null when invalid/tampered.
 */
export async function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [body, sig] = token.split('.');
  if (!body || !sig) {
    return null;
  }
  let sigBytes;
  let expected;
  try {
    sigBytes = b64urlDecode(sig);
    const key = await importKey(secret);
    expected = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
    );
  } catch {
    return null;
  }
  if (sigBytes.length !== expected.length) {
    return null;
  }
  // Constant-time-ish comparison.
  let diff = 0;
  for (let i = 0; i < sigBytes.length; i++) {
    diff |= sigBytes[i] ^ expected[i];
  }
  if (diff !== 0) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
}

/**
 * Is a verified payload still within its TTL?
 *
 * @param {{exp?: number}} payload
 * @param {number} [nowSec]
 * @returns {boolean}
 */
export function isFresh(payload, nowSec = Math.floor(Date.now() / 1000)) {
  return Boolean(payload) && typeof payload.exp === 'number' && payload.exp >= nowSec;
}
