# Plugin Update Server — Task List

Working backlog. Check items off as they land. Grouped by area; nothing here is
committed to a release yet.

## UI / styling

- [x] **Shared visual shell** — `src/theme.js` exports `CSS` + `shell()` (branded
  topbar + footer), used by both the public pages (`/request`, `/recover`) and
  the admin dashboard. Dependency-free (our own CSS).
- [x] **Public forms facelift** — card-wrapped forms, branded topbar/footer,
  styled alerts (`--err`/`--ok`/`--info`), button + input polish. Single file,
  no build step.
- [x] **Admin dashboard facelift** — topbar, KPI tiles, panel-wrapped tables,
  status/mode badges, monospace key cells, responsive/mobile layout.
- [ ] **Decide on a library** (optional): hand-rolled CSS (default) vs Tabler
  (CSS-only, MIT). AdminLTE only if we're happy with Bootstrap weight.
- [x] **Shared shell** — topbar/footer factored into `theme.js`; public + admin
  no longer drift. (A shared *header partial* was the original phrasing.)
- [ ] **Copyable licence keys** — click-to-copy on the dashboard (JS, optional).
- [ ] **Optional chart/sparkline** on the dashboard for "active sites over time".

## Admin actions on licences

- [ ] **Edit a licence** from the dashboard: status (active/disabled),
  `mode` (observe/enforce), `max_sites`, `expires`.
- [ ] **Issue / re-issue** a key from the admin UI (and email it).
- [ ] **Disable / delete** a key.
- [ ] **JSON endpoints** to mirror each action (`/v1/admin/licenses/:key`,
  `PATCH`-style) with the same bearer/session auth.
- [ ] **Audit trail** — record who/what changed an admin-edited licence
  (or at least a timestamped `updated_at` + source).

## Domain enforcement

- [ ] Decide a **safe default** and let the operator flip a licence to
  `enforce` (admin UI + JSON). Auto-issue currently records domains in
  `observe` mode only.
- [ ] **Dashboard column**: bound sites vs. allowance, and a warning when a
  site fails enforcement.
- [ ] **Bind a domain** deliberately (operator action) vs. auto-claim on first
  check-in — currently we do NOT auto-claim unbound domains.
- [ ] Reject semantics: `site_required` / `site_mismatch` already exist; add
  operator-facing "why was this blocked" visibility.

## Data hygiene

- [ ] **Retention/pruning** for `checkins` and `rate_events` (scheduled job or
  opportunistic prune). `rate_events` already prunes >1 day opportunistically.
- [ ] **Retire the legacy `LICENSE_STORE` static-JSON fallback** once D1 is
  the sole source (migrate any remaining records first).
- [ ] **Indexes** review for the dashboard aggregates as data grows.

## Observability

- [ ] **Request/issue logging** — counts of requests, auto-issues, resends,
  recoveries, rate-limit hits.
- [ ] **Health/readiness** — extend `/v1/health` (D1 reachability, last mail
  send, version).
- [ ] **Lightweight metrics view** on the dashboard (sparklines optional).
- [ ] **Email observability** — surface Postmark failures; consider retry and
  a "your key changed" notice.

## Housekeeping

- [ ] **Plugin-side styling** of the licence-screen CTAs (small enqueued CSS,
  wrapper class) — deferred from the DNG/CFDUMP release.
- [ ] Consider a **CONTRACT.md** refresh if admin endpoints change.
