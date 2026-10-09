// Shared visual theme for every human-facing page.
//
// A single, dependency-free stylesheet + a small HTML "shell" (branded topbar
// + footer) used by both the public forms (/request, /recover) and the admin
// dashboard. Keeping it here means the two never drift, and it stays cheap to
// ship from a Worker (one inline <style>, no external assets, no build step).
//
// The look is a single dark "app shell": a navy gradient topbar (based on
// #0A1B3C), card panels, KPI tiles and a blue accent. Colours are all CSS
// custom properties in DARK below, so a future re-skin is a few token edits.

/** Brand identity used in the topbar, footer and page titles. */
export const BRAND = {
  name: 'ConnectBench',
  tagline: 'Plugin licences & updates',
};

/** The theme's colour tokens. */
export const DARK = `
  --brand: #3b82f6;
  --brand-600: #2563eb;
  --brand-700: #60a5fa;
  --ink: #e6edf6;
  --ink-soft: #9fb0c6;
  --ink-faint: #6b7c93;
  --line: #263349;
  --line-soft: #1d2739;
  --bg: #0a1428;
  --surface: #121a2a;
  --surface-2: #0f1726;
  --topbar: #0a1b3c;         /* base navy: the gradient anchor */
  --topbar-soft: #16305f;    /* lighter tint of the base for a clear gradient */
  --topbar-ink: #eaf0fb;
  --topbar-tag: #9db2d6;
  --ok: #4ade80;   --ok-bg: #0f2a1c;   --ok-line: #1c5137;
  --warn: #fbbf24; --warn-bg: #2a2410; --warn-line: #5a4a17;
  --err: #f87171;  --err-bg: #2a1414;  --err-line: #5a2424;
  --info: #93c5fd; --info-bg: #10233f; --info-line: #1f3c65;
  --field-bg: #0d1524;
  --field-focus: rgba(59, 130, 246, .28);
  --row-hover: #16213a;
  --th-bg: #0f1726;
  --shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 32px -16px rgba(0,0,0,.75);
  --mark-grad: linear-gradient(135deg, #38bdf8, #6366f1);
  color-scheme: dark;
`;

/**
 * Build the stylesheet.
 *
 * @returns {string}
 */
export function css() {
  return `
  :root {
    --radius: 12px;
    --radius-sm: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    ${DARK}
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.55 var(--font);
    -webkit-font-smoothing: antialiased;
  }

  a { color: var(--brand-700); }
  a:hover { color: var(--brand-600); }

  .topbar {
    background: linear-gradient(180deg, var(--topbar-soft), var(--topbar));
    color: var(--topbar-ink);
    border-bottom: 1px solid var(--line);
  }
  .topbar__inner {
    max-width: 1100px; margin: 0 auto; padding: .85rem 1.25rem;
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  }
  .brand { display: flex; align-items: center; gap: .6rem; text-decoration: none; color: var(--topbar-ink); }
  .brand__mark {
    width: 30px; height: 30px; border-radius: 8px; flex: none;
    background: var(--mark-grad);
    display: grid; place-items: center; font-weight: 700; font-size: .9rem; color: #fff;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
  }
  .brand__name { font-weight: 650; letter-spacing: .2px; }
  .brand__tag { font-size: .72rem; color: var(--topbar-tag); display: block; margin-top: -.1rem; }
  .topbar__actions { display: flex; align-items: center; gap: .5rem; }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  .wrap--narrow { max-width: 30rem; }

  .page-head { margin: 0 0 1.25rem; }
  .page-head h1 { font-size: 1.5rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .page-head p { margin: 0; color: var(--ink-soft); }

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

  label { display: block; margin: 1.1rem 0 .3rem; font-weight: 600; font-size: .88rem; }
  label:first-child { margin-top: 0; }
  input, select, textarea {
    width: 100%; padding: .6rem .75rem; font: inherit; color: inherit;
    background: var(--field-bg); border: 1px solid var(--line); border-radius: var(--radius-sm);
    transition: border-color .15s, box-shadow .15s;
  }
  input:focus, select:focus, textarea:focus {
    outline: none; border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--field-focus);
  }
  input::placeholder { color: var(--ink-faint); }
  .hint { font-size: .8rem; color: var(--ink-faint); margin-top: .35rem; }
  .req { color: var(--err); }

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
  .btn--ghost { background: transparent; color: var(--topbar-ink); border-color: var(--line); }
  .btn--ghost:hover { background: rgba(127,127,127,.15); color: var(--topbar-ink); }
  .btn--subtle { background: var(--line-soft); color: var(--ink); border-color: var(--line); }
  .btn--subtle:hover { background: var(--row-hover); color: var(--ink); }
  .btn-row { margin-top: 1.4rem; }

  .alert {
    border-radius: var(--radius-sm); padding: .75rem 1rem; margin: 0 0 1.1rem;
    border: 1px solid var(--line); font-size: .92rem;
  }
  .alert strong { font-weight: 650; }
  .alert--err { background: var(--err-bg); border-color: var(--err-line); color: var(--err); }
  .alert--ok { background: var(--ok-bg); border-color: var(--ok-line); color: var(--ok); }
  .alert--warn { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }
  .alert--info { background: var(--info-bg); border-color: var(--info-line); color: var(--info); }

  .badge {
    display: inline-block; padding: .12rem .55rem; border-radius: 999px;
    font-size: .75rem; font-weight: 600; line-height: 1.5; white-space: nowrap;
    border: 1px solid transparent;
  }
  .badge--ok { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-line); }
  .badge--off { background: var(--err-bg); color: var(--err); border-color: var(--err-line); }
  .badge--muted { background: var(--line-soft); color: var(--ink-soft); border-color: var(--line); }
  .badge--brand { background: var(--info-bg); color: var(--info); border-color: var(--info-line); }

  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  thead th {
    text-align: left; font-weight: 620; color: var(--ink-soft); font-size: .78rem;
    text-transform: uppercase; letter-spacing: .04em; padding: .55rem .75rem;
    border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--th-bg);
  }
  tbody td { padding: .6rem .75rem; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: var(--row-hover); }
  td.empty { color: var(--ink-faint); font-style: italic; }
  .mono { font-family: var(--mono); font-size: .86em; }
  .keycell {
    font-family: var(--mono); font-size: .84em; background: var(--line-soft);
    border-radius: 6px; padding: .12rem .45rem; white-space: nowrap;
  }

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
}

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
 * @param {string} o.title        Document <title>.
 * @param {string} o.body         Inner HTML (already escaped by the caller).
 * @param {string} [o.actions]    Optional topbar right-hand HTML (e.g. a form).
 * @param {string} [o.wrapClass]  Extra class on the content wrapper.
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
<style>${css()}</style>
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
