-- Plugin update server — D1 schema.
--
-- Apply with:
--   npx wrangler d1 execute plugin-update-server --file=./schema.sql         (remote)
--   npx wrangler d1 execute plugin-update-server --local --file=./schema.sql (local dev)
--
-- The `licenses` table is the durable record of every key ever issued. It also
-- carries the (currently unused) enforcement fields — mode / max_sites —
-- plus the per-domain history, so that turning on domain locking later needs
-- no data migration. See src/licenses.js.

CREATE TABLE IF NOT EXISTS licenses (
  key        TEXT PRIMARY KEY,            -- e.g. "DNG-A2B3-C4D5-E6F7"
  email      TEXT NOT NULL,               -- owner contact (recovery lookup)
  name       TEXT,                        -- optional
  products   TEXT NOT NULL,               -- JSON array of slugs, or ["*"]
  status     TEXT NOT NULL DEFAULT 'active',
  expires    TEXT,                        -- 'YYYY-MM-DD' or NULL
  mode       TEXT NOT NULL DEFAULT 'observe',  -- 'observe' | 'enforce' (later)
  max_sites  INTEGER,                     -- NULL = unlimited; 1 = single-site
  created_at INTEGER NOT NULL,            -- unix seconds
  domains    TEXT NOT NULL DEFAULT '{}'   -- JSON: domain -> {first_seen,last_seen}
);

CREATE INDEX IF NOT EXISTS idx_licenses_email  ON licenses(email);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);

-- Daily-aggregated check-ins. One row per (key, domain, plugin, day), which
-- keeps write volume ~1 row/site/day rather than one per update request.
CREATE TABLE IF NOT EXISTS checkins (
  key       TEXT NOT NULL,
  domain    TEXT NOT NULL DEFAULT '',     -- '' when the client sent none yet
  plugin    TEXT NOT NULL,
  day       TEXT NOT NULL,                -- 'YYYY-MM-DD' (UTC)
  version   TEXT,
  country   TEXT,                         -- from CF-IPCountry header
  count     INTEGER NOT NULL DEFAULT 1,
  last_seen INTEGER NOT NULL,             -- unix seconds
  PRIMARY KEY (key, domain, plugin, day)
);

CREATE INDEX IF NOT EXISTS idx_checkins_plugin ON checkins(plugin);
CREATE INDEX IF NOT EXISTS idx_checkins_day    ON checkins(day);

-- Audit log of public key requests (mirrors what is emailed/issued).
CREATE TABLE IF NOT EXISTS requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  name       TEXT,
  domain     TEXT NOT NULL,
  plugin     TEXT NOT NULL,
  key        TEXT,                        -- the key issued (or re-sent)
  ip         TEXT,
  country    TEXT,
  created_at INTEGER NOT NULL             -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_requests_email  ON requests(email);
CREATE INDEX IF NOT EXISTS idx_requests_ip     ON requests(ip);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);

-- Lightweight rate limiting for the public /request and /recover endpoints.
CREATE TABLE IF NOT EXISTS rate_events (
  bucket     TEXT NOT NULL,               -- e.g. "request:ip:1.2.3.4"
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events(bucket, created_at);
