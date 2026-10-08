import { describe, it, expect } from 'vitest';
import {
  createSession,
  verifySession,
  sessionSetCookie,
  sessionClearCookie,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL,
} from '../src/session.js';

const env = { ADMIN_TOKEN: 'super-secret-token' };

describe('session cookies', () => {
  it('round-trips a valid session', async () => {
    const value = await createSession(env);
    expect(value).toBeTruthy();
    expect(await verifySession(env, value)).toBe(true);
  });

  it('rejects a session signed with a different token', async () => {
    const value = await createSession(env);
    expect(await verifySession({ ADMIN_TOKEN: 'other' }, value)).toBe(false);
  });

  it('rejects a tampered session value', async () => {
    const value = await createSession(env);
    expect(await verifySession(env, value + 'x')).toBe(false);
    expect(await verifySession(env, 'garbage')).toBe(false);
    expect(await verifySession(env, '')).toBe(false);
  });

  it('expires', async () => {
    const value = await createSession(env, 10, 1000);
    expect(await verifySession(env, value, 1005)).toBe(true);
    expect(await verifySession(env, value, 999999)).toBe(false);
  });

  it('produces a strict, httpOnly, secure Set-Cookie', () => {
    const c = sessionSetCookie('abc');
    expect(c).toContain(`${SESSION_COOKIE}=abc`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain(`Max-Age=${SESSION_TTL}`);
  });

  it('clears the cookie', () => {
    expect(sessionClearCookie()).toContain('Max-Age=0');
  });

  it('reads a cookie from a request', () => {
    const req = new Request('https://x/admin', {
      headers: { cookie: `foo=bar; ${SESSION_COOKIE}=xyz; baz=qux` },
    });
    expect(readCookie(req, SESSION_COOKIE)).toBe('xyz');
    expect(readCookie(req, 'foo')).toBe('bar');
    expect(readCookie(req, 'missing')).toBe('');
  });

  it('returns null session when ADMIN_TOKEN is unset', async () => {
    expect(await createSession({})).toBeNull();
    expect(await verifySession({}, 'anything')).toBe(false);
  });
});
