// D1 access layer.
//
// Every SQL statement in the worker lives here so handlers stay free of
// query strings and the schema is easy to reason about in one place. All
// functions accept the D1 binding (`env.DB`) as their first argument and are
// safe to call with a missing binding — they degrade to no-ops / null rather
// than throwing, so a misconfigured deploy never breaks update checks.

/**
 * @param {object} env
 * @returns {D1Database|null}
 */
export function getDb(env) {
  const db = env?.DB;
  return db && typeof db.prepare === 'function' ? db : null;
}

/**
 * UTC 'YYYY-MM-DD' for a unix-seconds timestamp.
 *
 * @param {number} [unixSec]
 * @returns {string}
 */
export function dayKey(unixSec = Math.floor(Date.now() / 1000)) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Licences
// ---------------------------------------------------------------------------

/**
 * Insert a new licence record.
 *
 * @param {object} env
 * @param {{key:string, email:string, name?:string, products:string[], status?:string,
 *          expires?:string|null, mode?:string, max_sites?:number|null, created_at:number,
 *          domains?:object}} rec
 * @returns {Promise<void>}
 */
export async function insertLicense(env, rec) {
  const db = getDb(env);
  if (!db) return;
  await db
    .prepare(
      `INSERT INTO licenses
         (key, email, name, products, status, expires, mode, max_sites, created_at, domains)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      rec.key,
      rec.email,
      rec.name ?? null,
      JSON.stringify(rec.products ?? []),
      rec.status ?? 'active',
      rec.expires ?? null,
      rec.mode ?? 'observe',
      rec.max_sites ?? null,
      rec.created_at,
      JSON.stringify(rec.domains ?? {})
    )
    .run();
}

/**
 * Fetch a licence row by key, decoding its JSON columns.
 *
 * @param {object} env
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getLicense(env, key) {
  const db = getDb(env);
  if (!db) return null;
  const row = await db
    .prepare(`SELECT * FROM licenses WHERE key = ?`)
    .bind(key)
    .first();
  return row ? decodeLicense(row) : null;
}

/**
 * Fetch all active licences for an email address.
 *
 * @param {object} env
 * @param {string} email
 * @returns {Promise<object[]>}
 */
export async function getLicensesByEmail(env, email) {
  const db = getDb(env);
  if (!db) return [];
  const res = await db
    .prepare(`SELECT * FROM licenses WHERE lower(email) = lower(?) ORDER BY created_at DESC`)
    .bind(email)
    .all();
  return (res?.results ?? []).map(decodeLicense);
}

/**
 * Fetch every licence (for the admin dashboard).
 *
 * @param {object} env
 * @returns {Promise<object[]>}
 */
export async function listLicenses(env) {
  const db = getDb(env);
  if (!db) return [];
  const res = await db
    .prepare(`SELECT * FROM licenses ORDER BY created_at DESC`)
    .all();
  return (res?.results ?? []).map(decodeLicense);
}

/**
 * Overwrite the `domains` map for a licence (used by telemetry to accumulate
 * first_seen / last_seen per domain).
 *
 * @param {object} env
 * @param {string} key
 * @param {object} domains
 * @returns {Promise<void>}
 */
export async function updateLicenseDomains(env, key, domains) {
  const db = getDb(env);
  if (!db) return;
  await db
    .prepare(`UPDATE licenses SET domains = ? WHERE key = ?`)
    .bind(JSON.stringify(domains), key)
    .run();
}

/**
 * @param {object} row
 * @returns {object}
 */
function decodeLicense(row) {
  return {
    ...row,
    products: safeJson(row.products, []),
    domains: safeJson(row.domains, {}),
  };
}

// ---------------------------------------------------------------------------
// Check-ins (daily aggregate)
// ---------------------------------------------------------------------------

/**
 * Upsert a daily check-in row, incrementing the count.
 *
 * @param {object} env
 * @param {{key:string, domain:string, plugin:string, version?:string|null,
 *          country?:string|null, nowSec:number}} e
 * @returns {Promise<void>}
 */
export async function upsertCheckin(env, e) {
  const db = getDb(env);
  if (!db) return;
  const day = dayKey(e.nowSec);
  await db
    .prepare(
      `INSERT INTO checkins (key, domain, plugin, day, version, country, count, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(key, domain, plugin, day)
       DO UPDATE SET
         count = count + 1,
         last_seen = excluded.last_seen,
         version = excluded.version,
         country = excluded.country`
    )
    .bind(
      e.key,
      e.domain ?? '',
      e.plugin,
      day,
      e.version ?? null,
      e.country ?? null,
      e.nowSec
    )
    .run();
}

/**
 * Summary aggregates for the dashboard.
 *
 * @param {object} env
 * @param {number} [activeSince] Unix seconds; check-ins after this count as "active".
 * @returns {Promise<object>}
 */
export async function summary(env, activeSince) {
  const db = getDb(env);
  if (!db) {
    return {
      installs: 0,
      active_sites: 0,
      by_plugin: [],
      by_country: [],
      by_version: [],
      by_domain: [],
    };
  }

  const byPlugin = await db
    .prepare(
      `SELECT plugin,
              COUNT(DISTINCT domain) AS sites,
              SUM(count)             AS checkins
         FROM checkins
        WHERE domain <> ''
        GROUP BY plugin
        ORDER BY sites DESC`
    )
    .all();

  const byCountry = await db
    .prepare(
      `SELECT COALESCE(country, '??') AS country,
              COUNT(DISTINCT domain) AS sites
         FROM checkins
        WHERE domain <> ''
        GROUP BY country
        ORDER BY sites DESC`
    )
    .all();

  const byVersion = await db
    .prepare(
      `SELECT plugin, version, COUNT(DISTINCT domain) AS sites
         FROM checkins
        WHERE domain <> '' AND version IS NOT NULL
        GROUP BY plugin, version
        ORDER BY plugin, version DESC`
    )
    .all();

  // Per-domain view: which sites run which plugins, on what version, where,
  // and when they were last seen. Grouped per domain so the dashboard shows
  // one row per site, with the plugins/versions collapsed into a list.
  const byDomain = await db
    .prepare(
      `SELECT domain,
              GROUP_CONCAT(DISTINCT plugin)  AS plugins,
              GROUP_CONCAT(DISTINCT version) AS versions,
              MAX(country)                   AS country,
              MIN(last_seen)                 AS first_seen,
              MAX(last_seen)                 AS last_seen,
              SUM(count)                     AS checkins
         FROM checkins
        WHERE domain <> ''
        GROUP BY domain
        ORDER BY last_seen DESC`
    )
    .all();

  const activeSites = await db
    .prepare(
      `SELECT COUNT(DISTINCT domain) AS n
         FROM checkins
        WHERE domain <> '' AND last_seen >= ?`
    )
    .bind(activeSince)
    .first();

  const installs = await db
    .prepare(`SELECT COUNT(*) AS n FROM licenses`)
    .first();

  return {
    installs: installs?.n ?? 0,
    active_sites: activeSites?.n ?? 0,
    by_plugin: byPlugin?.results ?? [],
    by_country: byCountry?.results ?? [],
    by_version: byVersion?.results ?? [],
    by_domain: byDomain?.results ?? [],
  };
}

// ---------------------------------------------------------------------------
// Requests (audit log)
// ---------------------------------------------------------------------------

/**
 * Record a public key request.
 *
 * @param {object} env
 * @param {{email:string, name?:string|null, domain:string, plugin:string,
 *          key?:string|null, ip?:string|null, country?:string|null, created_at:number}} r
 * @returns {Promise<void>}
 */
export async function insertRequest(env, r) {
  const db = getDb(env);
  if (!db) return;
  await db
    .prepare(
      `INSERT INTO requests (email, name, domain, plugin, key, ip, country, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      r.email,
      r.name ?? null,
      r.domain,
      r.plugin,
      r.key ?? null,
      r.ip ?? null,
      r.country ?? null,
      r.created_at
    )
    .run();
}

/**
 * Find the most recent request for (email, domain, plugin) within a window.
 * Used to power idempotent auto-issue ("resend the existing key").
 *
 * @param {object} env
 * @param {string} email
 * @param {string} domain
 * @param {string} plugin
 * @returns {Promise<object|null>}
 */
export async function findExistingLicense(env, email, domain, plugin) {
  const db = getDb(env);
  if (!db) return null;
  const row = await db
    .prepare(
      `SELECT * FROM licenses
        WHERE lower(email) = lower(?) AND json_extract(domains, '$.' || ?) IS NOT NULL
          AND products LIKE ?
        ORDER BY created_at DESC LIMIT 1`
    )
    .bind(email, domain, `%${plugin}%`)
    .first();
  return row ? decodeLicense(row) : null;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Count recent events for a bucket.
 *
 * @param {object} env
 * @param {string} bucket
 * @param {number} sinceSec
 * @returns {Promise<number>}
 */
export async function countRecent(env, bucket, sinceSec) {
  const db = getDb(env);
  if (!db) return 0;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND created_at >= ?`)
    .bind(bucket, sinceSec)
    .first();
  return row?.n ?? 0;
}

/**
 * Record a rate-limit event and opportunistically prune old ones.
 *
 * @param {object} env
 * @param {string} bucket
 * @param {number} nowSec
 * @param {number} [pruneBeforeSec]
 * @returns {Promise<void>}
 */
export async function recordRateEvent(env, bucket, nowSec, pruneBeforeSec) {
  const db = getDb(env);
  if (!db) return;
  await db
    .prepare(`INSERT INTO rate_events (bucket, created_at) VALUES (?, ?)`)
    .bind(bucket, nowSec)
    .run();
  if (typeof pruneBeforeSec === 'number') {
    await db
      .prepare(`DELETE FROM rate_events WHERE created_at < ?`)
      .bind(pruneBeforeSec)
      .run();
  }
}

/**
 * @param {string|null|undefined} raw
 * @param {*} fallback
 * @returns {*}
 */
function safeJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Latest-download events (/v1/latest/*)
// ---------------------------------------------------------------------------

/**
 * Record a hit on a public /v1/latest/* endpoint.
 *
 * @param {object} env
 * @param {{product:string, kind:'info'|'download', version?:string|null,
 *          country?:string|null, nowSec:number}} e
 * @returns {Promise<void>}
 */
export async function recordLatestEvent(env, e) {
  const db = getDb(env);
  if (!db) return;
  await db
    .prepare(
      `INSERT INTO latest_events (product, kind, version, country, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(e.product, e.kind, e.version ?? null, e.country ?? null, e.nowSec)
    .run();
}

/**
 * Counts of latest-events per product/kind within a window (for the admin).
 *
 * @param {object} env
 * @param {number} sinceSec
 * @returns {Promise<Array<{product:string, kind:string, hits:number}>>}
 */
export async function latestEventCounts(env, sinceSec) {
  const db = getDb(env);
  if (!db) return [];
  const res = await db
    .prepare(
      `SELECT product, kind, COUNT(*) AS hits
         FROM latest_events
        WHERE created_at >= ?
        GROUP BY product, kind
        ORDER BY product, kind`
    )
    .bind(sinceSec)
    .all();
  return res?.results ?? [];
}
