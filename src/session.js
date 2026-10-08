// Signed admin session cookies.
//
// A session cookie is just the existing signed-token machinery from sign.js:
//   base64url({ exp }) . base64url(HMAC_SHA256(payload, sessionSecret))
//
// The signing secret is derived from ADMIN_TOKEN, so rotating that secret
// invalidates every live session immediately. The payload only carries an
// expiry — there is nothing to tamper with, and the cookie cannot be extended
// client-side (the signature covers `exp`).

import { createToken, verifyToken, isFresh } from './sign.js';

export const SESSION_COOKIE = 'admin_session';
const DEFAULT_TTL = 12 * 3600; // 12 hours

/**
 * Derive a distinct session-signing secret from the admin token so the raw
 * ADMIN_TOKEN is never itself placed in a cookie.
 *
 * @param {object} env
 * @returns {Promise<string>|null}
 */
function sessionSecret(env) {
  const token = typeof env?.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  if (!token) return null;
  // A fixed namespace + the token. HMAC-ing it gives a value that is safe to
  // use as a key and does not leak the token if a cookie were reversed.
  return `admin-session:${token}`;
}

/**
 * Create a signed session cookie value.
 *
 * @param {object} env
 * @param {number} [ttlSec]
 * @param {number} [nowSec]
 * @returns {Promise<string|null>}
 */
export async function createSession(env, ttlSec = DEFAULT_TTL, nowSec = Math.floor(Date.now() / 1000)) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  return createToken({ exp: nowSec + ttlSec, iat: nowSec }, secret);
}

/**
 * Verify a session cookie value.
 *
 * @param {object} env
 * @param {string} value
 * @param {number} [nowSec]
 * @returns {Promise<boolean>}
 */
export async function verifySession(env, value, nowSec = Math.floor(Date.now() / 1000)) {
  const secret = sessionSecret(env);
  if (!secret || !value) return false;
  const payload = await verifyToken(value, secret);
  return isFresh(payload, nowSec);
}

/**
 * Build the Set-Cookie header that starts a session.
 *
 * @param {string} value
 * @param {number} [ttlSec]
 * @returns {string}
 */
export function sessionSetCookie(value, ttlSec = DEFAULT_TTL) {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${ttlSec}`,
  ].join('; ');
}

/**
 * Build the Set-Cookie header that clears the session.
 *
 * @returns {string}
 */
export function sessionClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Read a named cookie from a Request.
 *
 * @param {Request} request
 * @param {string} name
 * @returns {string}
 */
export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      return rest.join('=') || '';
    }
  }
  return '';
}

export { DEFAULT_TTL as SESSION_TTL };
