import { describe, it, expect } from 'vitest';
import { generateKey, randomKeyBody, looksLikeKey } from '../src/keys.js';
import { normaliseDomain } from '../src/telemetry.js';
import { getKeyPrefix } from '../src/products.js';

describe('keys', () => {
  it('generates a prefixed key', () => {
    const k = generateKey('dawesome-name-generator');
    expect(k.startsWith('DNG-')).toBe(true);
    expect(k.split('-')).toHaveLength(4); // prefix + 3 groups
  });

  it('uses the cfdump prefix', () => {
    expect(generateKey('cfdump').startsWith('CFD-')).toBe(true);
  });

  it('produces ambiguity-free bodies', () => {
    for (let i = 0; i < 50; i++) {
      const body = randomKeyBody();
      expect(body).not.toMatch(/[01OI]/);
    }
  });

  it('generates distinct keys', () => {
    const set = new Set();
    for (let i = 0; i < 200; i++) set.add(generateKey('cfdump'));
    expect(set.size).toBe(200);
  });

  it('throws without a prefix for an unknown product', () => {
    expect(() => generateKey('ghost')).toThrow();
  });

  it('exposes prefixes via getKeyPrefix', () => {
    expect(getKeyPrefix('dawesome-name-generator')).toBe('DNG');
    expect(getKeyPrefix('cfdump')).toBe('CFD');
    expect(getKeyPrefix('ghost')).toBeNull();
  });

  it('structurally recognises keys', () => {
    expect(looksLikeKey(generateKey('cfdump'))).toBe(true);
    expect(looksLikeKey('nope')).toBe(false);
    expect(looksLikeKey('')).toBe(false);
  });
});

describe('normaliseDomain', () => {
  it('strips scheme, path, port and www', () => {
    expect(normaliseDomain('https://Example.com/foo?x=1')).toBe('example.com');
    expect(normaliseDomain('http://www.example.com:8080/path')).toBe('example.com');
    expect(normaliseDomain('example.com')).toBe('example.com');
    expect(normaliseDomain('www.example.co.uk')).toBe('example.co.uk');
  });

  it('handles empty / missing input', () => {
    expect(normaliseDomain('')).toBe('');
    expect(normaliseDomain(null)).toBe('');
    expect(normaliseDomain(undefined)).toBe('');
    expect(normaliseDomain('   ')).toBe('');
  });
});
