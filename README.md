# Plugin Update Server

A small, product-agnostic licence + update delivery endpoint for self-hosted
WordPress plugins. It runs on **Cloudflare Workers** and keeps the single
GitHub credential server-side, so no secret ever ships inside a plugin.

The plugin only ever holds:

* the URL of this server, and
* a **per-site licence key** (unique per customer).

This server holds the **fine-grained GitHub PAT** and uses it to read the
private release assets. It then hands the client a **short-lived signed
download URL** (HMAC), so the private asset URL is never reusable.

## Endpoints

### Public API (consumed by the WP plugin)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/update` | Version/licence check for a plugin. |
| `GET` | `/v1/download/:token` | Streams the signed release asset (single use, TTL). |
| `GET` | `/v1/health` | Liveness probe. |

### Public web flows (consumed by humans)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET/POST` | `/request` | Request a licence key (auto-issued + emailed). |
| `GET/POST` | `/recover` | Lost-key recovery — emails all keys on file for an address. |

### Operator-only (admin)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin` | Usage dashboard (HTML). Shows a sign-in form when not authenticated. |
| `POST` | `/admin/login` | Verify `ADMIN_TOKEN`, start a signed session cookie. |
| `POST` | `/admin/logout` | Clear the session. |
| `GET` | `/v1/admin/summary` | Aggregate usage JSON. |
| `GET` | `/v1/admin/licenses` | All licence records (JSON). |

### `GET /v1/update`

Query params:

| Param | Required | Notes |
| --- | --- | --- |
| `plugin` | yes | Product slug, e.g. `dawesome-name-generator`. |
| `license` | yes | The site's licence key. |
| `version` | no | Currently installed version (informational). |
| `php` | no | Installed PHP version. |
| `wp` | no | Installed WP version. |
| `site` | no* | Site URL/host. Used for usage telemetry, and for domain locking on `enforce`-mode licences (see below). |

See `CONTRACT.md` for the exact response shapes.

## Usage telemetry

Every successful `/v1/update` records a check-in (which site, which version,
which country) so the operator can see where each plugin is installed. It is
**fire-and-forget** and can never break an update response.

* Check-ins are **aggregated per (key, domain, plugin, day)** — one row per
  site per day — to stay well within D1's free write quota.
* Each licence also accumulates a per-domain `first_seen` / `last_seen` history.
* Domain locking (`mode`, `max_sites`) is **opt-in per licence**. The default
  `observe` mode records but never enforces. Set a licence's `mode` to
  `enforce` (with `max_sites`) to lock its key to the domain(s) bound to it: a
  request from any other domain — or with no `site` at all — is rejected with
  `site_mismatch` / `site_required`. Bind a domain by issuing/recovering the key
  for that domain, or by its first successful check-in. No migration needed.

## Admin

`/admin` is protected by a **signed, `HttpOnly`, `Secure`, `SameSite=Strict`
session cookie**. Visit `/admin`, enter your `ADMIN_TOKEN` on the sign-in
form, and a 12-hour session is started. The token is never put in a URL.

The JSON endpoints accept either the session cookie or a bearer header:

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://plugin-update-server.connectbench.com/v1/admin/summary
```

If `ADMIN_TOKEN` is unset, all admin routes return `503 admin_disabled`.

## Design goals

* **No shared secret in shipped code.** The GitHub PAT lives here only.
* **Multi-product.** Adding a plugin = one entry in `src/products.js`.
* **Cheap to run.** Cloudflare Workers + D1, zero servers to babysit.
* **Signed downloads.** HMAC tokens with a short TTL, tied to a product + release.
* **Operator insight.** Know who/where your plugins are installed.

## Layout

```
web/public_html/
  wrangler.toml            Cloudflare Worker config
  schema.sql               D1 schema (licenses, checkins, requests, rate_events)
  package.json             Dev deps (wrangler, vitest)
  src/
    index.js               Router + handlers
    products.js            Product registry (slug -> GitHub repo, key prefix)
    licenses.js            Licence lookup (D1 + legacy secret fallback)
    db.js                  D1 access layer (all SQL lives here)
    telemetry.js           Fire-and-forget check-in recording
    keys.js                Product-prefixed key generation
    email.js               Postmark transactional mail
    public.js              /request and /recover web flows
    admin.js               /admin dashboard + /v1/admin/* JSON
    session.js             Signed admin session cookies
    github.js              GitHub API client (release lookup)
    sign.js                HMAC sign/verify for tokens + sessions
    responses.js           JSON/HTTP helpers
  test/
    worker.test.js         Unit tests for the original pure logic
    telemetry.test.js      Keys + domain normalisation
    session.test.js        Session cookie flows
  CONTRACT.md              JSON contract shared with the plugin
```

## Configuration

Secrets are provided via `wrangler secret` (never committed):

| Secret | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Fine-grained PAT with read access to the private repos. |
| `SIGNING_SECRET` | HMAC key for signing download URLs. |
| `POSTMARK_TOKEN` | Postmark server token for transactional mail. |
| `ADMIN_TOKEN` | Guards `/admin` and `/v1/admin/*`. |
| `LICENSE_STORE` | *Optional* legacy static JSON map (fallback only). |

Plain vars live in `wrangler.toml`:

| Var | Purpose |
| --- | --- |
| `UPDATE_BASE_URL` | Public base URL of this worker (for building download URLs). |
| `DOWNLOAD_TTL` | Signed URL lifetime in seconds (default `300`). |
| `POSTMARK_FROM` | Verified sender address for outgoing mail. |
| `NOTIFY_EMAIL` | Address notified whenever a key is issued. |
| `ACTIVE_WINDOW` | Seconds a site counts as "active" after its last check-in. |

## Licence store

The authoritative store is **D1** (`licenses` table). Records look like:

```json
{
  "key": "DNG-AAAA-BBBB-CCCC",
  "email": "owner@example.com",
  "name": "Ada",
  "products": ["dawesome-name-generator"],
  "status": "active",
  "expires": null,
  "mode": "observe",
  "max_sites": null,
  "domains": { "example.com": { "first_seen": 1735689600, "last_seen": 1735999999 } }
}
```

`products` is a list of product slugs the key unlocks, or `["*"]` for all.
`mode` / `max_sites` / `domains` drive optional domain locking: `observe`
(the default) only records, `enforce` restricts the key to its bound
domains.

## Local development

```sh
npm install
npm run dev        # wrangler dev
npm test           # vitest

# Apply the schema to the local D1 database:
npx wrangler d1 execute plugin-update-server --local --file=./schema.sql
```

## Deploy

```sh
# 1. Create the D1 database and paste its id into wrangler.toml.
npx wrangler d1 create plugin-update-server

# 2. Apply the schema (remote).
npx wrangler d1 execute plugin-update-server --file=./schema.sql

# 3. Secrets.
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SIGNING_SECRET
npx wrangler secret put POSTMARK_TOKEN
npx wrangler secret put ADMIN_TOKEN

# 4. Ship it.
npm run deploy
```

Verify your `POSTMARK_FROM` sender in Postmark first, and make sure the
transactional `MessageStream` in `src/email.js` matches your account
(default: `outbound`).
