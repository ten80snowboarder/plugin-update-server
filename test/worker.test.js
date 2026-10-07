import { describe, it, expect } from 'vitest';
import { getProduct } from '../src/products.js';
import { parseStore, recordIsActive, recordUnlocksProduct, lookupLicense } from '../src/licenses.js';
import { createToken, verifyToken, isFresh, b64urlEncode, b64urlDecode } from '../src/sign.js';
import { pickAsset } from '../src/github.js';

describe('products', () => {
  it('finds a registered product', () => {
    expect(getProduct('dawesome-name-generator')).toBeTruthy();
  });
  it('returns null for unknown product', () => {
    expect(getProduct('nope')).toBeNull();
    expect(getProduct('')).toBeNull();
  });
});

describe('licenses', () => {
  const store = {
    'KEY-ALL': { products: ['*'], status: 'active', expires: null },
    'KEY-ONE': { products: ['dawesome-name-generator'], status: 'active', expires: null },
    'KEY-OTHER': { products: ['other-plugin'], status: 'active', expires: null },
    'KEY-EXPIRED': { products: ['*'], status: 'active', expires: '2000-01-01' },
    'KEY-INACTIVE': { products: ['*'], status: 'disabled', expires: null },
  };

  it('parses a JSON store string', () => {
    expect(Object.keys(parseStore(JSON.stringify(store)))).toHaveLength(5);
    expect(parseStore('not json')).toEqual({});
    expect(parseStore(null)).toEqual({});
  });

  it('checks product unlock', () => {
    expect(recordUnlocksProduct(store['KEY-ALL'], 'anything')).toBe(true);
    expect(recordUnlocksProduct(store['KEY-ONE'], 'dawesome-name-generator')).toBe(true);
    expect(recordUnlocksProduct(store['KEY-ONE'], 'other')).toBe(false);
  });

  it('checks active/expiry', () => {
    const now = Math.floor(Date.parse('2025-01-01T00:00:00Z') / 1000);
    expect(recordIsActive(store['KEY-ALL'], now)).toBe(true);
    expect(recordIsActive(store['KEY-EXPIRED'], now)).toBe(false);
    expect(recordIsActive(store['KEY-INACTIVE'], now)).toBe(false);
  });

  it('validates a good key', () => {
    expect(lookupLicense('KEY-ALL', 'dawesome-name-generator', store)).toEqual({ ok: true });
    expect(lookupLicense('KEY-ONE', 'dawesome-name-generator', store)).toEqual({ ok: true });
  });

  it('rejects a bad key', () => {
    expect(lookupLicense('NOPE', 'dawesome-name-generator', store).error).toBe('invalid_license');
  });

  it('rejects a product mismatch', () => {
    expect(lookupLicense('KEY-OTHER', 'dawesome-name-generator', store).error).toBe(
      'license_product_mismatch'
    );
  });

  it('rejects an unknown product', () => {
    expect(lookupLicense('KEY-ALL', 'ghost', store).error).toBe('unknown_product');
  });
});

describe('signing', () => {
  it('round-trips base64url', () => {
    const bytes = b64urlDecode(b64urlEncode('hello world+/?'));
    expect(new TextDecoder().decode(bytes)).toBe('hello world+/?');
  });

  it('creates and verifies a token', async () => {
    const payload = { product: 'x', asset_id: 1, exp: 9999999999 };
    const token = await createToken(payload, 'secret');
    expect(await verifyToken(token, 'secret')).toEqual(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await createToken({ product: 'x', exp: 9999999999 }, 'secret');
    expect(await verifyToken(token + 'x', 'secret')).toBeNull();
    expect(await verifyToken(token, 'wrong-secret')).toBeNull();
  });

  it('detects expiry', () => {
    expect(isFresh({ exp: 100 }, 50)).toBe(true);
    expect(isFresh({ exp: 10 }, 50)).toBe(false);
    expect(isFresh(null, 50)).toBe(false);
  });
});

describe('pickAsset', () => {
  const release = {
    assets: [
      { name: 'readme.txt', url: 'u1' },
      { name: 'dawesome-name-generator.zip', url: 'u2' },
      { name: 'other.zip', url: 'u3' },
    ],
  };
  it('picks the matching zip', () => {
    expect(pickAsset(release, 'dawesome-name-generator').url).toBe('u2');
  });
  it('falls back to first zip', () => {
    expect(pickAsset(release, null).url).toBe('u2');
    expect(pickAsset(release, 'nomatch').url).toBe('u2');
  });
  it('returns null when no zip', () => {
    expect(pickAsset({ assets: [{ name: 'a.txt' }] }, null)).toBeNull();
    expect(pickAsset({}, null)).toBeNull();
  });
});
