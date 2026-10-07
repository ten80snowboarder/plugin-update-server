// Product registry.
//
// Maps a product slug (as sent by the plugin) to the GitHub repository that
// hosts its releases. Adding a new plugin to the update server is a one-line
// change here (plus giving the PAT access to the repo).
//
// `repo`            GitHub "owner/name".
// `homepage`        Shown in the plugin's details modal.
// `asset_pattern`   Substring a release asset filename must contain to be the
//                   installable zip. Leave null to accept the first .zip asset.

export const PRODUCTS = {
  'dawesome-name-generator': {
    repo: 'toballydawes/dawesome-name-generator',
    homepage: 'https://toballydawes.com/',
    asset_pattern: 'dawesome-name-generator',
  },
};

/**
 * Look up a product by slug.
 *
 * @param {string} slug
 * @returns {object|null}
 */
export function getProduct(slug) {
  if (!slug || typeof slug !== 'string') {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(PRODUCTS, slug) ? PRODUCTS[slug] : null;
}
