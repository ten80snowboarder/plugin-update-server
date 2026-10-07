// Tiny HTTP/JSON response helpers shared by the handlers.

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/**
 * Build a JSON Response.
 *
 * @param {object} body
 * @param {number} [status]
 * @returns {Response}
 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * A soft failure: HTTP 200 with valid:false so the plugin can show a notice.
 *
 * @param {string} error   Machine-readable code (see CONTRACT.md).
 * @param {string} message Human-readable explanation.
 * @returns {Response}
 */
export function softFail(error, message) {
  return json({ valid: false, error, message }, 200);
}

/**
 * A hard failure (bad token, server error).
 *
 * @param {number} status
 * @param {string} error
 * @param {string} message
 * @returns {Response}
 */
export function hardFail(status, error, message) {
  return json({ valid: false, error, message }, status);
}

/**
 * CORS preflight / headers. The plugin calls server-side, so CORS is only
 * relevant for browser testing, but it is cheap to support.
 *
 * @returns {Record<string,string>}
 */
export function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}
