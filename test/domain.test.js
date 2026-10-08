import { describe, it, expect } from 'vitest';
import { checkDomain, validateRecord } from '../src/licenses.js';

const PRODUCT = 'dawesome-name-generator';
const NOW = Math.floor(Date.parse('2025-01-01T00:00:00Z') / 1000);

/**
 * Build a licence record with sensible defaults for domain tests.
 *
 * @param {object} [over]
 * @returns {object}
 */
function rec(over = {}) {
  return {
    products: [PRODUCT],
    status: 'active',
    expires: null,
    mode: 'observe',
    max_sites: null,
    domains: {},
    ...over,
  };
}

describe('checkDomain', () => {
  it('allows anything in observe mode (default), even with a mismatch', () => {
    const r = rec({ mode: 'observe', max_sites: 1, domains: { 'a.com': {} } });
    expect(checkDomain(r, 'https://b.com/')).toEqual({ ok: true });
    expect(checkDomain(r, null)).toEqual({ ok: true });
  });

  it('allows when enforce mode has no site limit', () => {
    const r = rec({ mode: 'enforce', max_sites: null, domains: {} });
    expect(checkDomain(r, 'https://anything.example')).toEqual({ ok: true });
  });

  it('allows an already-bound domain in enforce mode', () => {
    const r = rec({ mode: 'enforce', max_sites: 1, domains: { 'example.com': {} } });
    expect(checkDomain(r, 'https://example.com/')).toEqual({ ok: true });
    // www + scheme + path all normalise to the same bound domain.
    expect(checkDomain(r, 'http://www.example.com/path?a=1')).toEqual({ ok: true });
  });

  it('requires a site in enforce mode', () => {
    const r = rec({ mode: 'enforce', max_sites: 1, domains: { 'example.com': {} } });
    expect(checkDomain(r, null).error).toBe('site_required');
    expect(checkDomain(r, '').error).toBe('site_required');
  });

  it('rejects a different domain in enforce mode', () => {
    const r = rec({ mode: 'enforce', max_sites: 1, domains: { 'example.com': {} } });
    expect(checkDomain(r, 'https://evil.example/').error).toBe('site_mismatch');
  });

  it('rejects once max_sites is reached (multi-site)', () => {
    const r = rec({
      mode: 'enforce',
      max_sites: 2,
      domains: { 'a.com': {}, 'b.com': {} },
    });
    expect(checkDomain(r, 'https://a.com/')).toEqual({ ok: true });
    expect(checkDomain(r, 'https://c.com/').error).toBe('site_mismatch');
  });

  it('does not auto-claim an unbound domain even when there is room', () => {
    const r = rec({ mode: 'enforce', max_sites: 2, domains: { 'a.com': {} } });
    // Room for a 2nd site, but binding is the operator/telemetry's job.
    expect(checkDomain(r, 'https://brand-new.com/').error).toBe('site_mismatch');
  });
});

describe('validateRecord domain integration', () => {
  it('still validates product/expiry before the domain check', () => {
    const inactive = rec({ status: 'disabled', mode: 'enforce', max_sites: 1 });
    expect(validateRecord(inactive, PRODUCT, NOW, 'https://x.com').error).toBe('license_expired');
  });

  it('enforces the domain lock only when mode is enforce', () => {
    const observe = rec({ mode: 'observe', max_sites: 1, domains: { 'example.com': {} } });
    expect(validateRecord(observe, PRODUCT, NOW, 'https://other.com')).toEqual({ ok: true });

    const enforce = rec({ mode: 'enforce', max_sites: 1, domains: { 'example.com': {} } });
    expect(validateRecord(enforce, PRODUCT, NOW, 'https://other.com').error).toBe('site_mismatch');
    expect(validateRecord(enforce, PRODUCT, NOW, 'https://example.com')).toEqual({ ok: true });
  });

  it('is backward compatible when no site argument is passed', () => {
    // Existing callers (no site) must keep working for observe records.
    const observe = rec({ mode: 'observe', max_sites: 1 });
    expect(validateRecord(observe, PRODUCT, NOW)).toEqual({ ok: true });
  });
});
