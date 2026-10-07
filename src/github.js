// GitHub API client.
//
// Only ever called server-side with the server-held PAT. Talks to the public
// REST API for a *private* repo (the PAT grants access). We use the "latest
// release" endpoint and the asset list it returns.

const API_BASE = 'https://api.github.com';

/**
 * Fetch the latest published release for a repo.
 *
 * @param {string} repo   "owner/name"
 * @param {string} token  Fine-grained PAT.
 * @param {string} [userAgent]
 * @returns {Promise<{ ok: true, release: object } | { ok: false, status: number, message: string }>}
 */
export async function getLatestRelease(repo, token, userAgent = 'plugin-update-server') {
  const url = `${API_BASE}/repos/${repo}/releases/latest`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': userAgent,
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch (err) {
    return { ok: false, status: 0, message: `network error: ${err.message}` };
  }

  if (res.status === 404) {
    return { ok: false, status: 404, message: 'No published release found.' };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: `GitHub responded ${res.status}.` };
  }

  const release = await res.json();
  return { ok: true, release };
}

/**
 * Pick the installable zip asset from a release, honouring asset_pattern.
 *
 * @param {object} release
 * @param {string|null} pattern Substring the asset name must contain.
 * @returns {object|null}
 */
export function pickAsset(release, pattern) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zips = assets.filter((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip'));
  if (zips.length === 0) {
    return null;
  }
  if (pattern) {
    const match = zips.find((a) => a.name.includes(pattern));
    if (match) {
      return match;
    }
  }
  return zips[0];
}

/**
 * Download a release asset binary and return the Response, authenticated.
 *
 * Uses the asset's API `url` (e.g. https://api.github.com/repos/o/r/releases/assets/123)
 * with `Accept: application/octet-stream` so GitHub redirects to a signed
 * storage URL for private repos.
 *
 * @param {string} assetApiUrl The asset `url` field from the release payload.
 * @param {string} token       Fine-grained PAT.
 * @param {string} [userAgent]
 * @returns {Promise<{ ok: true, response: Response } | { ok: false, status: number, message: string }>}
 */
export async function downloadAsset(assetApiUrl, token, userAgent = 'plugin-update-server') {
  if (typeof assetApiUrl !== 'string' || !assetApiUrl.startsWith(`${API_BASE}/`)) {
    return { ok: false, status: 400, message: 'Invalid asset URL.' };
  }
  try {
    const res = await fetch(assetApiUrl, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/octet-stream',
        'user-agent': userAgent,
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `Asset fetch failed (${res.status}).` };
    }
    return { ok: true, response: res };
  } catch (err) {
    return { ok: false, status: 0, message: `network error: ${err.message}` };
  }
}
