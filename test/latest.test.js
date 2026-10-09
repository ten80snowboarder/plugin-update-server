import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleLatest } from '../src/latest.js';
import { verifyToken } from '../src/sign.js';

/** Call handleLatest with a request + the path segment after /v1/latest/. */
function callLatest(rest, e = env()) {
  return handleLatest(new Request(`https://updates.example.com/v1/latest/${rest}`), e, rest);
}

/** Minimal env for a happy-path resolve. */
function env() {
  return {
    GITHUB_TOKEN: 'ghp_test',
    SIGNING_SECRET: 's3cret',
    UPDATE_BASE_URL: 'https://updates.example.com',
    DOWNLOAD_TTL: '300',
  };
}

/** Stub global fetch to return a canned GitHub latest-release payload. */
function stubRelease(assets, { tag = 'v1.4.14', published = '2026-09-22T10:00:00Z' } = {}) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ tag_name: tag, published_at: published, assets }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  ));
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /v1/latest/:product', () => {
  it('302-redirects to a signed download URL for the latest zip', async () => {
    stubRelease([{ id: 42, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/42' }]);
    const res = await callLatest('cfdump');
    expect(res.status).toBe(302);

    const loc = res.headers.get('location');
    expect(loc).toMatch(/^https:\/\/updates\.example\.com\/v1\/download\//);

    // The signed token should decode to our product + asset.
    const token = loc.split('/v1/download/')[1];
    const payload = await verifyToken(token, 's3cret');
    expect(payload.product).toBe('cfdump');
    expect(payload.asset_id).toBe(42);
    expect(payload.asset_url).toBe('https://api.github.com/repos/o/r/releases/assets/42');
  });

  it('accepts a .zip suffix (convenient for a Download button)', async () => {
    stubRelease([{ id: 7, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/7' }]);
    const res = await callLatest('cfdump.zip');
    expect(res.status).toBe(302);
  });

  it('honours the asset_pattern when several zips exist', async () => {
    stubRelease([
      { id: 1, name: 'something-else.zip', url: 'https://api.github.com/repos/o/r/releases/assets/1' },
      { id: 2, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/2' },
    ]);
    const res = await callLatest('cfdump');
    const payload = await verifyToken(res.headers.get('location').split('/v1/download/')[1], 's3cret');
    expect(payload.asset_id).toBe(2);
  });

  it('404s for an unknown product', async () => {
    const res = await callLatest('ghost');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('unknown_product');
  });

  it('404s when the release has no zip asset', async () => {
    stubRelease([{ id: 1, name: 'notes.txt', url: 'https://api.github.com/repos/o/r/releases/assets/1' }]);
    const res = await callLatest('cfdump');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('no_release');
  });
});

describe('GET /v1/latest/:product/info', () => {
  it('returns JSON with version, date and a download URL', async () => {
    stubRelease([{ id: 42, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/42' }], {
      tag: 'v1.4.14',
      published: '2026-09-22T09:30:00Z',
    });
    const res = await callLatest('cfdump/info');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.product).toBe('cfdump');
    expect(body.version).toBe('1.4.14'); // leading "v" stripped
    expect(body.published_at).toBe('2026-09-22 09:30:00');
    expect(body.download_url).toContain('/v1/download/');
    expect(body.requires_php).toBe('8.2');
  });
});
