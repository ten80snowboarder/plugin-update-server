import { describe, it, expect } from 'vitest';
import { summary } from '../src/db.js';

// A minimal fake D1 binding. Each `.prepare(sql)` inspects the SQL and returns
// canned results, mirroring the shape db.summary() expects (.all()/.first()).
function fakeDb() {
  return {
    prepare(sql) {
      const runner = {
        _sql: sql,
        bind() { return runner; },
        async all() {
          if (/GROUP_CONCAT\(DISTINCT plugin\)/.test(sql)) {
            return {
              results: [
                {
                  domain: 'example.com',
                  plugins: 'cfdump,dawesome-name-generator',
                  versions: '0.1.6,1.5.4',
                  country: 'US',
                  first_seen: 1_700_000_000,
                  last_seen: 1_700_100_000,
                  checkins: 5,
                },
              ],
            };
          }
          if (/COUNT\(DISTINCT domain\) AS sites/.test(sql) && /GROUP BY plugin/.test(sql)) {
            return { results: [{ plugin: 'cfdump', sites: 1, checkins: 5 }] };
          }
          if (/COALESCE\(country/.test(sql)) {
            return { results: [{ country: 'US', sites: 1 }] };
          }
          if (/GROUP BY plugin, version/.test(sql)) {
            return { results: [{ plugin: 'cfdump', version: '1.5.4', sites: 1 }] };
          }
          return { results: [] };
        },
        async first() {
          if (/COUNT\(\*\) AS n FROM licenses/.test(sql)) return { n: 3 };
          if (/last_seen >= \?/.test(sql)) return { n: 1 };
          return { n: 0 };
        },
        async run() { return {}; },
      };
      return runner;
    },
  };
}

describe('summary', () => {
  it('degrades to empty aggregates with no DB binding', async () => {
    const data = await summary({}, 0);
    expect(data).toEqual({
      installs: 0,
      active_sites: 0,
      by_plugin: [],
      by_country: [],
      by_version: [],
      by_domain: [],
    });
  });

  it('includes a by_domain aggregate keyed per site', async () => {
    const data = await summary({ DB: fakeDb() }, 0);
    expect(data.installs).toBe(3);
    expect(data.active_sites).toBe(1);
    expect(Array.isArray(data.by_domain)).toBe(true);
    expect(data.by_domain).toHaveLength(1);
    expect(data.by_domain[0]).toMatchObject({
      domain: 'example.com',
      plugins: 'cfdump,dawesome-name-generator',
      versions: '0.1.6,1.5.4',
      country: 'US',
    });
  });
});
