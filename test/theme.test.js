import { describe, it, expect } from 'vitest';
import { esc, shell, CSS, BRAND } from '../src/theme.js';

describe('theme esc()', () => {
  it('escapes the dangerous characters', () => {
    expect(esc('<script>"&</script>')).toBe('&lt;script&gt;&quot;&amp;&lt;/script&gt;');
  });

  it('coerces null/undefined to an empty string', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('theme shell()', () => {
  it('produces a full HTML document with the brand and stylesheet', () => {
    const html = shell({ title: 'Hi', body: '<p>hello</p>' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain(`<title>Hi</title>`);
    expect(html).toContain(BRAND.name);
    expect(html).toContain('<style>');
    expect(html).toContain('<p>hello</p>');
    // Admin pages must never be indexed.
    expect(html).toContain('noindex');
  });

  it('escapes the title but not the trusted body', () => {
    const html = shell({ title: '<x>', body: '<b>ok</b>' });
    expect(html).toContain('<title>&lt;x&gt;</title>');
    expect(html).toContain('<b>ok</b>');
  });

  it('includes optional topbar actions', () => {
    const html = shell({ title: 't', body: '', actions: '<button>Sign out</button>' });
    expect(html).toContain('<button>Sign out</button>');
  });

  it('exposes a non-empty stylesheet with brand tokens', () => {
    expect(CSS).toContain('--brand:');
    expect(CSS.length).toBeGreaterThan(200);
  });
});
