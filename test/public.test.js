import { describe, it, expect } from 'vitest';
import { handleRequestForm, handleRecoverForm } from '../src/public.js';

/**
 * A tiny in-memory stand-in for the D1 binding.
 *
 * Each `.prepare(sql)` returns a runner that pattern-matches on the SQL it was
 * given and answers from the arrays below. That is enough to exercise the
 * insert/select/rate-limit paths in db.js without a real database.
 */
function fakeDb() {
  const state = { licenses: [], requests: [], rate: [] };
  return {
    state,
    prepare(sql) {
      const runner = {
        _binds: [],
        bind(...args) {
          runner._binds = args;
          return runner;
        },
        async run() {
          if (/INSERT INTO licenses/.test(sql)) {
            const [key, email, name, products, status, expires, mode, max_sites, created_at, domains] =
              runner._binds;
            state.licenses.push({
              key, email, name, products, status, expires, mode, max_sites, created_at, domains,
            });
          } else if (/INSERT INTO requests/.test(sql)) {
            state.requests.push(runner._binds);
          } else if (/INSERT INTO rate_events/.test(sql)) {
            state.rate.push(runner._binds);
          } else if (/DELETE FROM rate_events/.test(sql)) {
            const before = runner._binds[0];
            state.rate = state.rate.filter((r) => r[1] >= before);
          }
          return {};
        },
        async first() {
          if (/FROM rate_events WHERE bucket/.test(sql)) {
            const [bucket, since] = runner._binds;
            return { n: state.rate.filter((r) => r[0] === bucket && r[1] >= since).length };
          }
          if (/FROM licenses/.test(sql)) {
            const [email, domain, productGlob] = runner._binds;
            const slug = String(productGlob).replace(/%/g, '');
            const hit = state.licenses.find(
              (l) =>
                l.email.toLowerCase() === String(email).toLowerCase() &&
                l.domains &&
                Object.prototype.hasOwnProperty.call(JSON.parse(l.domains), domain) &&
                JSON.parse(l.products).includes(slug)
            );
            return hit ?? null;
          }
          return null;
        },
        async all() {
          if (/FROM licenses WHERE lower\(email\)/.test(sql)) {
            const [email] = runner._binds;
            return {
              results: state.licenses.filter(
                (l) => l.email.toLowerCase() === String(email).toLowerCase()
              ),
            };
          }
          return { results: [] };
        },
      };
      return runner;
    },
  };
}

/**
 * Build a GET request to /request with optional query string.
 *
 * @param {string} qs
 * @returns {Request}
 */
function getRequest(qs = '') {
  return new Request(`https://plugin-update-server.connectbench.com/request${qs}`, {
    method: 'GET',
  });
}

/**
 * Build a POST request to /request with form fields.
 *
 * @param {Record<string,string>} fields
 * @returns {Request}
 */
function postRequest(fields) {
  return new Request('https://plugin-update-server.connectbench.com/request', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('GET /request pre-fill', () => {
  it('renders an empty form with no query string', async () => {
    const res = await handleRequestForm(getRequest(), {}, {});
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Request a licence key');
    expect(html).toContain('value=""');
  });

  it('pre-fills plugin, domain and name from the query string', async () => {
    const res = await handleRequestForm(
      getRequest('?plugin=cfdump&domain=example.com&name=My%20Site&ref=CFDUMP'),
      {},
      {}
    );
    const html = await res.text();
    expect(html).toContain('value="example.com"');
    expect(html).toContain('value="My Site"');
    // The matching product option is selected.
    expect(html).toMatch(/<option value="cfdump" selected>/);
    // The "opened from your plugin" hint is shown (the label is wrapped in a
    // <strong>, so match loosely on the surrounding text).
    expect(html).toMatch(/Opened from your <strong>CFDUMP<\/strong> plugin/);
  });

  it('ignores an unknown plugin (no option selected)', async () => {
    const res = await handleRequestForm(getRequest('?plugin=ghost'), {}, {});
    const html = await res.text();
    expect(html).not.toMatch(/<option value="ghost"/);
    expect(html).not.toMatch(/selected>/);
  });
});

describe('POST /request auto-issue', () => {
  it('mints, stores and emails a key, and records the request', async () => {
    const db = fakeDb();
    const env = { DB: db, UPDATE_BASE_URL: 'https://plugin-update-server.connectbench.com' };
    const res = await handleRequestForm(
      postRequest({
        email: 'user@example.com',
        domain: 'https://www.example.com/path',
        plugin: 'dawesome-name-generator',
      }),
      env,
      {}
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Check your email');
    expect(html).toContain('user@example.com');

    // One licence, keyed DNG-, observe mode, domain normalised.
    expect(db.state.licenses).toHaveLength(1);
    const lic = db.state.licenses[0];
    expect(lic.key.startsWith('DNG-')).toBe(true);
    expect(lic.mode).toBe('observe');
    expect(JSON.parse(lic.domains)).toHaveProperty('example.com');
    expect(lic.email).toBe('user@example.com');

    // And an audit row for the request.
    expect(db.state.requests).toHaveLength(1);
  });

  it('is idempotent: a repeat request re-sends the existing key', async () => {
    const db = fakeDb();
    const env = { DB: db, UPDATE_BASE_URL: 'https://plugin-update-server.connectbench.com' };
    const fields = {
      email: 'user@example.com',
      domain: 'example.com',
      plugin: 'dawesome-name-generator',
    };

    await handleRequestForm(postRequest(fields), env, {});
    const firstKey = db.state.licenses[0].key;

    const res2 = await handleRequestForm(postRequest(fields), env, {});
    const html = await res2.text();

    expect(db.state.licenses).toHaveLength(1); // no duplicate minted
    expect(html).toContain('already have a key');
    expect(db.state.licenses[0].key).toBe(firstKey);
  });

  it('rejects invalid submissions with a 400 and no side effects', async () => {
    const db = fakeDb();
    const env = { DB: db };
    const res = await handleRequestForm(
      postRequest({ email: 'not-an-email', domain: 'nope', plugin: 'ghost' }),
      env,
      {}
    );
    expect(res.status).toBe(400);
    expect(db.state.licenses).toHaveLength(0);
  });

  it('rate-limits a flood of requests from one email', async () => {
    const db = fakeDb();
    const env = { DB: db };
    let last;
    for (let i = 0; i < 7; i++) {
      last = await handleRequestForm(
        postRequest({ email: 'spam@example.com', domain: 'example.com', plugin: 'cfdump' }),
        env,
        {}
      );
    }
    // Per-email cap is 5/hour, so the 7th must be throttled.
    expect(last.status).toBe(429);
  });
});

describe('GET/POST /recover', () => {
  it('always returns the same no-enumeration page on POST', async () => {
    const db = fakeDb();
    const res = await handleRecoverForm(
      new Request('https://plugin-update-server.connectbench.com/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'nobody@example.com' }).toString(),
      }),
      { DB: db },
      {}
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('If we have a licence key on file');
    // No-enumeration: the page is phrased conditionally ("If we have ..."),
    // never asserting that a key does or does not exist for the address.
    expect(html).toContain('If we have');
  });
});
