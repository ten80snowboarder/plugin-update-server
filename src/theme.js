// Shared visual theme for every human-facing page.
//
// A single, dependency-free stylesheet + a small HTML "shell" (branded topbar
// + footer) used by both the public forms (/request, /recover) and the admin
// dashboard. Keeping it here means the two never drift, and it stays cheap to
// ship from a Worker (one inline <style>, no external assets, no build step).
//
// The look is AdminLTE-flavoured — dark/navy topbar, card panels, KPI tiles,
// muted borders, a single accent colour — but rolled by hand so we avoid
// Bootstrap/jQuery weight. Swap for Tabler later if we outgrow it; the shell
// and class names are deliberately generic so that's a CSS-only change.

/** Brand identity used in the topbar, footer and page titles. */
export const BRAND = {
  name: 'ConnectBench',
  tagline: 'Plugin licences & updates',
};

/**
 * The full stylesheet. Rendered into a <style> tag by `shell()`.
 *
 * Uses CSS custom properties so a future white-label is a handful of overrides.
 */
export const CSS = `
  :root {
    --brand: #2563eb;
    --brand-600: #1d4ed8;
    --brand-700: #1e40af;
    --ink: #0f172a;
    --ink-soft: #475569;
    --ink-faint: #94a3b8;
    --line: #e2e8f0;
    --line-soft: #eef2f7;
    --bg: #f1f5f9;
    --surface: #ffffff;
    --topbar: #111c33;
    --topbar-soft: #1b2947;
    --ok: #15803d;
    --ok-bg: #ecfdf3;
    --warn: #b45309;
    --warn-bg: #fffbeb;
    --err: #b91c1c;
    --err-bg: #fef2f2;
    --radius: 12px;
    --radius-sm: 8px;
    --shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 8px 24px -12px rgba(15, 23, 42, .18);
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.55 var(--font);
    -webkit-font-smoothing: antialiased;
  }

  a { color: var(--brand-600); }
  a:hover { color: var(--brand-700); }

  /* --- Topbar ---------------------------------------------------------- */
  .topbar {
    background: linear-gradient(180deg, var(--topbar-soft), var(--topbar));
    color: #fff;
  }
  .topbar__inner {
    max-width: 1100px; margin: 0 auto; padding: .85rem 1.25rem;
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  }
  .brand { display: flex; align-items: center; gap: .6rem; text-decoration: none; color: #fff; }
  .brand__mark {
    width: 30px; height: 30px; border-radius: 8px; flex: none;
    background: linear-gradient(135deg, #60a5fa, var(--brand));
    display: grid; place-items: center; font-weight: 700; font-size: .9rem;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
  }
  .brand__name { font-weight: 650; letter-spacing: .2px; }
  .brand__tag { font-size: .72rem; color: #a9b6cf; display: block; margin-top: -.1rem; }
  .topbar__actions { display: flex; align-items: center; gap: .5rem; }

  /* --- Layout ---------------------------------------------------------- */
  .wrap { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  .wrap--narrow { max-width: 30rem; }

  .page-head { margin: 0 0 1.25rem; }
  .page-head h1 { font-size: 1.5rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .page-head p { margin: 0; color: var(--ink-soft); }

  /* --- Cards ----------------------------------------------------------- */
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .card__body { padding: 1.4rem 1.5rem; }
  .card__head {
    padding: .9rem 1.5rem; border-bottom: 1px solid var(--line-soft);
    font-weight: 620; font-size: .95rem; display: flex; align-items: center; gap: .5rem;
  }
  .card__head .count {
    margin-left: auto; font-weight: 500; font-size: .78rem; color: var(--ink-soft);
    background: var(--line-soft); border-radius: 999px; padding: .1rem .55rem;
  }
  .stack { display: grid; gap: 1.25rem; }

  /* --- KPI tiles ------------------------------------------------------- */
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .tile {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 1.1rem 1.2rem; box-shadow: var(--shadow);
    display: flex; flex-direction: column; gap: .35rem; position: relative; overflow: hidden;
  }
  .tile::after {
    content: ""; position: absolute; inset: 0 auto 0 0; width: 4px;
    background: var(--brand); opacity: .85;
  }
  .tile__n { font-size: 1.9rem; font-weight: 700; line-height: 1; letter-spacing: -.02em; }
  .tile__l { color: var(--ink-soft); font-size: .82rem; }

  /* --- Forms ----------------------------------------------------------- */
  label { display: block; margin: 1.1rem 0 .3rem; font-weight: 600; font-size: .88rem; }
  label:first-child { margin-top: 0; }
  input, select, textarea {
    width: 100%; padding: .6rem .75rem; font: inherit; color: inherit;
    background: #fff; border: 1px solid var(--line); border-radius: var(--radius-sm);
    transition: border-color .15s, box-shadow .15s;
  }
  input:focus, select:focus, textarea:focus {
    outline: none; border-color: var(--brand);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, .15);
  }
  .hint { font-size: .8rem; color: var(--ink-faint); margin-top: .35rem; }
  .req { color: var(--err); }

  /* --- Buttons --------------------------------------------------------- */
  .btn {
    display: inline-flex; align-items: center; gap: .45rem;
    padding: .58rem 1.1rem; font: inherit; font-weight: 620; font-size: .92rem;
    border: 1px solid transparent; border-radius: var(--radius-sm);
    background: var(--brand); color: #fff; cursor: pointer; text-decoration: none;
    transition: background .15s, box-shadow .15s, transform .02s;
  }
  .btn:hover { background: var(--brand-600); color: #fff; }
  .btn:active { transform: translateY(1px); }
  .btn--block { width: 100%; justify-content: center; }
  .btn--ghost {
    background: transparent; color: inherit; border-color: rgba(255,255,255,.28);
  }
  .btn--ghost:hover { background: rgba(255,255,255,.1); color: #fff; }
  .btn--subtle {
    background: var(--line-soft); color: var(--ink); border-color: var(--line);
  }
  .btn--subtle:hover { background: var(--line); color: var(--ink); }
  .btn-row { margin-top: 1.4rem; }

  /* --- Alerts ---------------------------------------------------------- */
  .alert {
    border-radius: var(--radius-sm); padding: .75rem 1rem; margin: 0 0 1.1rem;
    border: 1px solid; font-size: .92rem;
  }
  .alert strong { font-weight: 650; }
  .alert--err { background: var(--err-bg); border-color: #fecaca; color: var(--err); }
  .alert--ok { background: var(--ok-bg); border-color: #bbf7d0; color: var(--ok); }
  .alert--warn { background: var(--warn-bg); border-color: #fde68a; color: var(--warn); }
  .alert--info { background: #eff6ff; border-color: #bfdbfe; color: var(--brand-700); }

  /* --- Badges ---------------------------------------------------------- */
  .badge {
    display: inline-block; padding: .12rem .55rem; border-radius: 999px;
    font-size: .75rem; font-weight: 600; line-height: 1.5; white-space: nowrap;
  }
  .badge--ok { background: var(--ok-bg); color: var(--ok); }
  .badge--off { background: var(--err-bg); color: var(--err); }
  .badge--muted { background: var(--line-soft); color: var(--ink-soft); }
  .badge--brand { background: #eff6ff; color: var(--brand-700); }

  /* --- Tables ---------------------------------------------------------- */
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  thead th {
    text-align: left; font-weight: 620; color: var(--ink-soft); font-size: .78rem;
    text-transform: uppercase; letter-spacing: .04em; padding: .55rem .75rem;
    border-bottom: 1px solid var(--line); white-space: nowrap; background: #f8fafc;
  }
  tbody td { padding: .6rem .75rem; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: #f8fafc; }
  td.empty { color: var(--ink-faint); font-style: italic; }
  .mono { font-family: var(--mono); font-size: .86em; }
  .keycell {
    font-family: var(--mono); font-size: .84em; background: var(--line-soft);
    border-radius: 6px; padding: .12rem .45rem; white-space: nowrap;
  }

  /* --- Misc ------------------------------------------------------------ */
  .muted { color: var(--ink-soft); }
  .foot { color: var(--ink-faint); font-size: .8rem; margin-top: 2.5rem; text-align: center; }
  .inline-links { display: flex; flex-wrap: wrap; gap: .35rem 1rem; }

  @media (max-width: 720px) {
    .tiles { grid-template-columns: repeat(2, 1fr); }
    .page-head h1 { font-size: 1.3rem; }
  }
  @media (max-width: 460px) {
    .tiles { grid-template-columns: 1fr; }
    .topbar__inner { padding: .7rem 1rem; }
    .wrap { padding: 1.1rem 1rem 2.5rem; }
  }
`;

/**
 * HTML-escape a value for safe interpolation.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap page content in the branded shell (topbar + footer).
 *
 * @param {object} o
 * @param {string} o.title     Document <title>.
 * @param {string} o.body      Inner HTML (already escaped by the caller).
 * @param {string} [o.actions] Optional topbar right-hand HTML (e.g. a form).
 * @param {string} [o.wrapClass] Extra class on the content wrapper.
 * @returns {string}
 */
export function shell({ title, body, actions = '', wrapClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar__inner">
      <a class="brand" href="/">
        <span class="brand__mark">CB</span>
        <span>
          <span class="brand__name">${esc(BRAND.name)}</span>
          <span class="brand__tag">${esc(BRAND.tagline)}</span>
        </span>
      </a>
      <div class="topbar__actions">${actions}</div>
    </div>
  </header>
  <main class="wrap ${wrapClass}">
    ${body}
    <p class="foot">${esc(BRAND.name)} &middot; ${esc(BRAND.tagline)}</p>
  </main>
</body>
</html>`;
}
