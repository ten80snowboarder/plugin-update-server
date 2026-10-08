# Update Server JSON Contract

Shared between the WordPress plugin client (`DawesomeNameGenerator\Updates`)
and this update server. Any change here must be reflected on both sides.

Base URL: `{UPDATE_BASE_URL}` (e.g. `https://updates.toballydawes.com`).

All responses are `application/json; charset=utf-8` except `/v1/download/:token`,
which streams `application/zip`.

---

## `GET /v1/update`

### Request

```
GET /v1/update?plugin=dawesome-name-generator&license=DNG-AAAA&version=0.1.0&php=8.1&wp=6.4
```

| Param | Required | Description |
| --- | --- | --- |
| `plugin` | yes | Product slug. |
| `license` | yes | Per-site licence key. |
| `version` | no | Installed plugin version (informational). |
| `php` | no | Installed PHP version. |
| `wp` | no | Installed WordPress version. |
| `site` | no* | The site's home URL/host (e.g. `https://example.com`). Send `home_url()`. Used for usage telemetry, and for **domain locking** on licences whose `mode` is `enforce`. See below. |

### Response — update available

HTTP `200`:

```json
{
  "valid": true,
  "product": "dawesome-name-generator",
  "version": "0.2.0",
  "download_url": "https://updates.example.com/v1/download/eyJ...signature",
  "homepage": "https://toballydawes.com/",
  "requires": "6.3",
  "tested": "6.5",
  "requires_php": "8.1",
  "last_updated": "2025-01-01 12:00:00",
  "changelog": "= 0.2.0 =\n* Added thing.",
  "sections": {
    "description": "<p>...</p>",
    "changelog": "<h4>0.2.0</h4><ul><li>...</li></ul>"
  }
}
```

Notes:

* `version` is the **latest** available version (may equal the installed one).
* The plugin compares `version` against its installed version itself; the
  server does not require `version` to decide whether to answer.
* `site` is recorded for the operator's usage dashboard. For licences in the
  default `observe` mode it has **no effect** on the response.
* `site` becomes **required** only when the licence's `mode` is `enforce` and it
  has a `max_sites` limit (`site_required`), and it must then match a domain the
  key is already bound to (`site_mismatch`). A key is bound to a domain by the
  operator at issue/recovery time, or by the first successful telemetry
  check-in — enforcement never emits a new binding from an update request.
  `www.example.com` and `example.com` (scheme/port/path stripped) count as the
  same domain.
* `download_url` is a **short-lived, signed** URL. It is safe to log; it
  expires and is bound to the product + release.

### Response — invalid licence / unknown product

HTTP `200` (deliberately not 4xx, so the plugin can show a friendly notice):

```json
{
  "valid": false,
  "error": "invalid_license",
  "message": "This licence key is not valid for this product."
}
```

Known `error` codes:

| Code | Meaning |
| --- | --- |
| `missing_params` | `plugin` and/or `license` not supplied. |
| `unknown_product` | `plugin` is not in the product registry. |
| `invalid_license` | Key not found in the licence store. |
| `license_product_mismatch` | Key exists but does not unlock this product. |
| `license_expired` | Key is past its `expires` date. |
| `site_required` | Licence is in `enforce` mode and the request did not send `site`. |
| `site_mismatch` | Licence is in `enforce` mode and `site` is not bound to this key (or the site limit is reached). |
| `no_release` | Repo has no published release yet. |
| `upstream_error` | GitHub call failed; `message` has detail. |

### Response — server error

HTTP `500` with the same `{"valid": false, "error": ..., "message": ...}` shape.

---

## `GET /v1/download/:token`

`token` is an opaque, HMAC-signed, base64url string produced by `/v1/update`.

Payload encoded in the token:

```json
{
  "product": "dawesome-name-generator",
  "asset_id": 123456789,
  "exp": 1735689600
}
```

* `exp` is a Unix timestamp; default TTL is `DOWNLOAD_TTL` (300s).
* On success the worker proxies the GitHub release asset and streams it as
  `application/zip` with `Content-Disposition: attachment`.
* On failure: HTTP `403` with `{"valid": false, "error": "expired_token" | "bad_token", "message": "..."}`.

---

## `GET /v1/health`

HTTP `200`:

```json
{ "ok": true, "time": 1735689600 }
```
