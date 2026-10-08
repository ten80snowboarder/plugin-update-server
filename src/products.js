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
// `requires`        Minimum WordPress version (shown in the details modal).
// `tested`          WordPress version the release is tested against.
// `requires_php`    Minimum PHP version.
// `description`     Short blurb shown in the details modal.
// `key_prefix`      Prefix used when minting licence keys for this product
//                   (e.g. "DNG" -> DNG-XXXX-XXXX-XXXX). Must be unique.

export const PRODUCTS = {
  'dawesome-name-generator': {
    repo: 'ten80snowboarder/dawesome-name-generator',
    homepage: 'https://toballydawes.com/',
    asset_pattern: 'dawesome-name-generator',
    requires: '6.3',
    tested: '6.7',
    requires_php: '8.1',
    key_prefix: 'DNG',
    description:
      'A configurable name / insult generator. Define your own word banks and background images to produce shareable name cards.',
  },
  cfdump: {
    repo: 'ten80snowboarder/cfdump',
    homepage: 'https://toballydawes.com/',
    asset_pattern: 'cfdump',
    requires: '6.3',
    tested: '7.1',
    requires_php: '8.2',
    key_prefix: 'CFD',
    description:
      'A simple plugin to add functionality like CFDUMP in ColdFusion/CFML.',
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

/**
 * The licence-key prefix for a product slug.
 *
 * @param {string} slug
 * @returns {string|null}
 */
export function getKeyPrefix(slug) {
  const product = getProduct(slug);
  return product?.key_prefix || null;
}
