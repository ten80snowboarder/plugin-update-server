// Telemetry: record which sites (domains) use which plugins.
//
// This is deliberately fire-and-forget. It is called from the /v1/update hot
// path, but must NEVER affect the response a customer receives: any error is
// swallowed and logged. It also tolerates a missing `site`/domain (the WP
// client does not send one yet) by recording the check-in with an empty
// domain, so aggregates are still meaningful for the client-upgrade period.
//
// Data model (see schema.sql):
//   * checkins      — daily aggregate row per (key, domain, plugin, day)
//   * licenses.domains — running first_seen/last_seen per domain per key,
//                        populated now but only *enforced* if/when a licence
//                        is switched to mode:'enforce'.

import { upsertCheckin, updateLicenseDomains, getLicense } from './db.js';

/**
 * Normalise a submitted site value to a bare hostname.
 *
 * Accepts "example.com", "https://example.com/", "www.example.com/path".
 *
 * @param {string|null|undefined} site
 * @returns {string} hostname (lowercase, no scheme/path) or '' when absent.
 */
export function normaliseDomain(site) {
  if (!site || typeof site !== 'string') return '';
  let s = site.trim().toLowerCase();
  if (!s) return '';
  // Strip scheme.
  s = s.replace(/^[a-z]+:\/\//, '');
  // Drop credentials, then path/query/fragment.
  s = s.replace(/^[^/@]*@/, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  // Drop port.
  s = s.split(':')[0];
  // Strip a single leading www. for stable aggregation.
  s = s.replace(/^www\./, '');
  return s;
}

/**
 * Record a check-in. Fire-and-forget: resolves void, never throws.
 *
 * @param {object} env
 * @param {{license:string, plugin:string, version?:string|null,
 *          site?:string|null, country?:string|null, nowSec?:number}} c
 * @returns {Promise<void>}
 */
export async function recordCheckin(env, c) {
  try {
    const nowSec = c.nowSec ?? Math.floor(Date.now() / 1000);
    const domain = normaliseDomain(c.site);

    await upsertCheckin(env, {
      key: c.license,
      domain,
      plugin: c.plugin,
      version: c.version ?? null,
      country: c.country ?? null,
      nowSec,
    });

    // Keep the licence's per-domain history current — but only when we have
    // a real domain. This is the data enforcement will later read.
    if (domain) {
      const lic = await getLicense(env, c.license);
      if (lic) {
        const domains = lic.domains || {};
        const existing = domains[domain];
        domains[domain] = {
          first_seen: existing?.first_seen ?? nowSec,
          last_seen: nowSec,
        };
        await updateLicenseDomains(env, c.license, domains);
      }
    }
  } catch (err) {
    // Telemetry must never break an update check.
    console.error('telemetry: recordCheckin failed:', err?.message || err);
  }
}
