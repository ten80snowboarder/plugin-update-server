// Outbound email via Postmark.
//
// Single seam for all transactional mail. Swapping providers later means
// rewriting this file only. All callers pass `env`; if POSTMARK_TOKEN is
// missing the send is skipped and the caller is told, so nothing throws on
// an unconfigured deploy.
//
// Postmark specifics:
//   * Endpoint: POST https://api.postmarkapp.com/email
//   * Auth:     X-Postmark-Server-Token header
//   * Stream:   transactional (never the broadcast stream for key delivery)

const POSTMARK_URL = 'https://api.postmarkapp.com/email';

/**
 * @param {object} env
 * @returns {{token: string, from: string} | null}
 */
function config(env) {
  const token = typeof env?.POSTMARK_TOKEN === 'string' ? env.POSTMARK_TOKEN : '';
  const from = typeof env?.POSTMARK_FROM === 'string' && env.POSTMARK_FROM ? env.POSTMARK_FROM : '';
  if (!token || !from) return null;
  return { token, from };
}

/**
 * Low-level send. Returns a result object; never throws.
 *
 * @param {object} env
 * @param {{to:string, subject:string, text:string, html?:string, replyTo?:string}} msg
 * @returns {Promise<{ok:true, id?:string} | {ok:false, error:string}>}
 */
export async function send(env, msg) {
  const cfg = config(env);
  if (!cfg) {
    return { ok: false, error: 'email_not_configured' };
  }

  const payload = {
    From: cfg.from,
    To: msg.to,
    Subject: msg.subject,
    TextBody: msg.text,
    MessageStream: 'outbound',
  };
  if (msg.html) payload.HtmlBody = msg.html;
  if (msg.replyTo) payload.ReplyTo = msg.replyTo;

  try {
    const res = await fetch(POSTMARK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-Postmark-Server-Token': cfg.token,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `postmark_${res.status}: ${detail.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data?.MessageID };
  } catch (err) {
    return { ok: false, error: `network: ${err.message}` };
  }
}

/**
 * Email a newly-issued (or re-sent) key to the requestor.
 *
 * @param {object} env
 * @param {{to:string, name?:string|null, key:string, plugin:string, domain:string, baseUrl:string}} o
 * @returns {Promise<{ok:true, id?:string} | {ok:false, error:string}>}
 */
export function sendKeyEmail(env, o) {
  const who = o.name ? `Hi ${o.name},` : 'Hi,';
  const text = [
    who,
    '',
    `Thanks for requesting a licence key for ${o.plugin}.`,
    '',
    'Your licence key is:',
    '',
    `    ${o.key}`,
    '',
    `Please keep it somewhere safe — you'll enter it in the plugin settings on ${o.domain}.`,
    'If you lose it, you can request it again at any time from the same page.',
    '',
    '— ConnectBench',
  ].join('\n');

  const html = [
    `<p>${escapeHtml(who)}</p>`,
    `<p>Thanks for requesting a licence key for <strong>${escapeHtml(o.plugin)}</strong>.</p>`,
    `<p>Your licence key is:</p>`,
    `<p style="font-family:monospace;font-size:16px;background:#f4f4f5;padding:12px;border-radius:6px;">${escapeHtml(o.key)}</p>`,
    `<p>Please keep it somewhere safe — you'll enter it in the plugin settings on <strong>${escapeHtml(o.domain)}</strong>. If you lose it, you can request it again at any time from the same page.</p>`,
    `<p>— ConnectBench</p>`,
  ].join('');

  return send(env, {
    to: o.to,
    subject: `Your ${o.plugin} licence key`,
    text,
    html,
  });
}

/**
 * Email one or more recovered keys to a site owner.
 *
 * @param {object} env
 * @param {{to:string, name?:string|null, keys:Array<{key:string, products:string[], domain?:string}>}} o
 * @returns {Promise<{ok:true, id?:string} | {ok:false, error:string}>}
 */
export function sendLostKeyEmail(env, o) {
  const who = o.name ? `Hi ${o.name},` : 'Hi,';

  const lines = o.keys.map((k) => `    ${k.key}   (${(k.products || []).join(', ') || 'all products'})`);
  const text = [
    who,
    '',
    'Here are the licence key(s) we have on file for this email address:',
    '',
    ...lines,
    '',
    'If you were not expecting this, you can safely ignore this email.',
    '',
    '— ConnectBench',
  ].join('\n');

  const items = o.keys
    .map(
      (k) =>
        `<li style="font-family:monospace;">${escapeHtml(k.key)} — ${escapeHtml((k.products || []).join(', ') || 'all products')}</li>`
    )
    .join('');
  const html = [
    `<p>${escapeHtml(who)}</p>`,
    `<p>Here are the licence key(s) we have on file for this email address:</p>`,
    `<ul>${items}</ul>`,
    `<p>If you were not expecting this, you can safely ignore this email.</p>`,
    `<p>— ConnectBench</p>`,
  ].join('');

  return send(env, {
    to: o.to,
    subject: 'Your licence key(s)',
    text,
    html,
  });
}

/**
 * Heads-up to the operator that a key was requested/issued.
 *
 * @param {object} env
 * @param {string} to
 * @param {{email:string, name?:string|null, domain:string, plugin:string,
 *          key:string, country?:string|null, ip?:string|null}} o
 * @returns {Promise<{ok:true, id?:string} | {ok:false, error:string}>}
 */
export function sendAdminNotice(env, to, o) {
  const text = [
    'A new licence key was requested and issued.',
    '',
    `Plugin:  ${o.plugin}`,
    `Domain:  ${o.domain}`,
    `Email:   ${o.email}`,
    o.name ? `Name:    ${o.name}` : null,
    `Key:     ${o.key}`,
    o.country ? `Country: ${o.country}` : null,
    o.ip ? `IP:      ${o.ip}` : null,
    '',
    '— plugin-update-server',
  ]
    .filter(Boolean)
    .join('\n');

  return send(env, {
    to,
    subject: `New key: ${o.plugin} @ ${o.domain}`,
    text,
  });
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
