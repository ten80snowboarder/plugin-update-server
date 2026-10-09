import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleLatest } from '../src/latest.js';
import { verifyToken } from '../src/sign.js';

/** Call handleLatest with a request + path segment, returning { res, ctx }. */
function callLatest(rest, e = env()) {
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const promise = handleLatest(new Request(`https://updates.example.com/v1/latest/${rest}`), e, rest, ctx);
  return { promise, waits, env: e };
}

/** Minimal env for a happy-path resolve, with a fake D1 that records SQL. */
function env() {
  const e = {
    GITHUB_TOKEN: 'ghp_test',
    SIGNING_SECRET: 's3cret',
    UPDATE_BASE_URL: 'https://updates.example.com',
    DOWNLOAD_TTL: '300',
    __events: [],
    __stats: { downloads: 11, downloads_30d: 4, active_sites: 3 },
  };
  e.DB = {
    prepare(sql) {
      const stmt = {
        _args: [],
        bind(...args) { stmt._args = args; return stmt; },
        async run() { e.__events.push({ sql, args: stmt._args }); },
        async first() {
          // productStats: downloads / downloads_30d / active_sites.
          if (/FROM latest_events/i.test(sql)) {
            return { n: /created_at >=/i.test(sql) ? e.__stats.downloads_30d : e.__stats.downloads };
          }
          if (/FROM checkins/i.test(sql)) return { n: e.__stats.active_sites };
          return null;
        },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return e;
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
    const res = await callLatest('cfdump').promise;
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
    const res = await callLatest('cfdump.zip').promise;
    expect(res.status).toBe(302);
  });

  it('honours the asset_pattern when several zips exist', async () => {
    stubRelease([
      { id: 1, name: 'something-else.zip', url: 'https://api.github.com/repos/o/r/releases/assets/1' },
      { id: 2, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/2' },
    ]);
    const res = await callLatest('cfdump').promise;
    const payload = await verifyToken(res.headers.get('location').split('/v1/download/')[1], 's3cret');
    expect(payload.asset_id).toBe(2);
  });

  it('404s for an unknown product', async () => {
    const res = await callLatest('ghost').promise;
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('unknown_product');
  });

  it('404s when the release has no zip asset', async () => {
    stubRelease([{ id: 1, name: 'notes.txt', url: 'https://api.github.com/repos/o/r/releases/assets/1' }]);
    const res = await callLatest('cfdump').promise;
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('no_release');
  });

  it('records a download event (fire-and-forget) with the resolved version', async () => {
    stubRelease([{ id: 9, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/9' }], {
      tag: 'v1.5.6',
    });
    const { promise, waits, env: e } = callLatest('cfdump.zip');
    await promise;

    // The count is scheduled via ctx.waitUntil, not awaited by the response.
    expect(waits).toHaveLength(1);
    await Promise.all(waits);

    expect(e.__events).toHaveLength(1);
    const [product, kind, version] = e.__events[0].args;
    expect(product).toBe('cfdump');
    expect(kind).toBe('download');
    expect(version).toBe('1.5.6');
  });
});

describe('GET /v1/latest/:product/info', () => {
  it('returns JSON with version, date and a download URL', async () => {
    stubRelease([{ id: 42, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/42' }], {
      tag: 'v1.4.14',
      published: '2026-09-22T09:30:00Z',
    });
    const res = await callLatest('cfdump/info').promise;
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.product).toBe('cfdump');
    expect(body.version).toBe('1.4.14'); // leading "v" stripped
    expect(body.published_at).toBe('2026-09-22 09:30:00');
    expect(body.download_url).toContain('/v1/download/');
    expect(body.requires_php).toBe('8.2');
    // Public stats are included.
    expect(body.downloads).toBe(11);
    expect(body.downloads_30d).toBe(4);
    expect(body.active_sites).toBe(3);
  });

  it('records an "info" event (blog cache refresh)', async () => {
    stubRelease([{ id: 42, name: 'cfdump.zip', url: 'https://api.github.com/repos/o/r/releases/assets/42' }]);
    const { promise, waits, env: e } = callLatest('cfdump/info');
    await promise;
    await Promise.all(waits);
    expect(e.__events[0].args[1]).toBe('info');
  });
});
