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

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/update` | Version/licence check for a plugin. |
| `GET` | `/v1/download/:token` | Streams the signed release asset (single use, TTL). |
| `GET` | `/v1/health` | Liveness probe. |

### `GET /v1/update`

Query params:

| Param | Required | Notes |
| --- | --- | --- |
| `plugin` | yes | Product slug, e.g. `dawesome-name-generator`. |
| `license` | yes | The site's licence key. |
| `version` | no | Currently installed version (informational). |
| `php` | no | Installed PHP version. |
| `wp` | no | Installed WP version. |

See `CONTRACT.md` for the exact response shapes.

## Design goals

* **No shared secret in shipped code.** The GitHub PAT lives here only.
* **Multi-product.** Adding a plugin = one entry in `src/products.js`.
* **Cheap to run.** Cloudflare Workers + KV, zero servers to babysit.
* **Signed downloads.** HHMAC tokens with a short TTL, tied to a product + release.

## Layout

```
web/public_html/
  wrangler.toml            Cloudflare Worker config
  package.json             Dev deps (wrangler, vitest)
  src/
    index.js               Router + handlers
    products.js            Product registry (slug -> GitHub repo, etc.)
    licenses.js            Licence store lookup
    github.js              GitHub API client (release lookup)
    sign.js                HMAC sign/verify for download tokens
    responses.js           JSON/HTTP helpers
  test/
    worker.test.js         Unit tests for the pure logic
  CONTRACT.md              JSON contract shared with the plugin
```

## Configuration

Secrets are provided via `wrangler secret` (never committed):

| Secret | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Fine-grained PAT with read access to the private repos. |
| `SIGNING_SECRET` | HMAC key for signing download URLs. |
| `LICENSE_STORE` | JSON map of licence keys (temporary, see below). |

Plain vars live in `wrangler.toml`:

| Var | Purpose |
| --- | --- |
| `UPDATE_BASE_URL` | Public base URL of this worker (for building download URLs). |
| `DOWNLOAD_TTL` | Signed URL lifetime in seconds (default `300`). |

### Licence store (temporary)

To start, licences are a **static JSON map** in the `LICENSE_STORE` secret:

```json
{
  "DNG-AAAA-BBBB-CCCC": { "products": ["dawesome-name-generator"], "status": "active", "expires": null },
  "DNG-DDDD-EEEE-FFFF": { "products": ["*"], "status": "active", "expires": "2030-01-01" }
}
```

`products` is a list of product slugs the key unlocks, or `["*"]` for all.
This is deliberately simple; a KV/DB-backed store with an admin UI is a
planned follow-up. The lookup lives behind `licenses.js` so swapping the
backing store later touches one file.

## Local development

```sh
npm install
npm run dev        # wrangler dev
npm test           # vitest
```

## Deploy

```sh
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SIGNING_SECRET
npx wrangler secret put LICENSE_STORE
npm run deploy
```
