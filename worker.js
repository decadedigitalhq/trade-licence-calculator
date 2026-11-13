// Trade Licence Calculator AU — Worker (Dex, Nov 2026)
// Static pages are served straight from assets. This script only runs for /api/* (see wrangler.jsonc)
// and for the daily cron that sends licence renewal reminders.
//
// Bindings / settings (Cloudflare → Workers & Pages → trade-licence-calculator → Settings):
//   REMINDERS        KV namespace (set in wrangler.jsonc)
//   SMTP2GO_API_KEY  Secret — Shaun adds it in the dashboard; never commit it
//   MAIL_FROM, SITE_URL  plain vars in wrangler.jsonc
//
// KV keys
//   pending:<token>                 unconfirmed sign-up, expires after 7 days
//   sub:<YYYY-MM>:<token>           confirmed reminder, keyed by licence expiry month
// Stored value: { email, state, trade, expiry, created, sent3, sent1 }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATES = { NSW: 'NSW', VIC: 'VIC', QLD: 'QLD', WA: 'WA', SA: 'SA' };
const TRADES = { electrician: 'Electrician', plumber: 'Plumber', builder: 'Builder' };
const GUIDE = { NSW: '/nsw-licence-renewal-guide', VIC: '/vic-licence-renewal-guide', QLD: '/qld-licence-renewal-guide', WA: '/wa-licence-renewal-guide', SA: '/sa-licence-renewal-guide' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BIZCOVER = 'https://insure.bizcover.com.au/OccupationSelection?utm_source=DDHQ&utm_medium=Form&utm_campaign=DDHQ';

const clean = (v, max) => String(v || '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const redirect = (env, path) => Response.redirect(new URL(path, env.SITE_URL).toString(), 303);

// Current year and month in Melbourne, as numbers.
export function melbourneNow(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: 'numeric' }).formatToParts(date);
  return { y: +p.find(x => x.type === 'year').value, m: +p.find(x => x.type === 'month').value };
}
export function addMonths({ y, m }, n) {
  const t = y * 12 + (m - 1) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}
export const ym = ({ y, m }) => y + '-' + String(m).padStart(2, '0');
const niceMonth = (expiry) => { const [y, m] = expiry.split('-'); return MONTHS[+m - 1] + ' ' + y; };

async function sendMail(env, to, subject, text) {
  const res = await fetch('https://api.smtp2go.com/v3/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Smtp2go-Api-Key': env.SMTP2GO_API_KEY },
    body: JSON.stringify({ sender: env.MAIL_FROM, to: [to], subject, text_body: text })
  });
  return res.ok;
}

// ---------- Email wording (Shaun approves before go-live) ----------

export function confirmEmail(env, rec, token) {
  const link = env.SITE_URL + '/api/remind/confirm?t=' + token;
  return {
    subject: 'Confirm your licence renewal reminder',
    text:
`Hi,

You asked us to remind you before your ${rec.state} ${TRADES[rec.trade].toLowerCase()} licence expires in ${niceMonth(rec.expiry)}.

Confirm here and we'll email you 3 months before and 1 month before:
${link}

If this wasn't you, ignore this email and nothing will be sent. The request is deleted after 7 days.

Trade Licence Calculator AU
${env.SITE_URL}
Operated by Decade Digital HQ, Melbourne. Not affiliated with any government regulator.`
  };
}

export function reminderEmail(env, rec, key, which) {
  const unsub = env.SITE_URL + '/api/remind/unsubscribe?k=' + encodeURIComponent(key);
  const calc = env.SITE_URL + '/?state=' + rec.state + '&trade=' + rec.trade;
  const guide = env.SITE_URL + GUIDE[rec.state];
  const when = which === 3 ? 'in about 3 months' : 'next month';
  const lateTip = {
    NSW: 'In NSW, renewing after expiry means paying the higher restoration fee, and after 3 months you may need to apply again.',
    VIC: rec.trade === 'builder'
      ? 'In Victoria, builders who lodge less than 3 months before expiry pay a late fee, so now is the time.'
      : 'In Victoria, a lapsed licence can mean re-applying at the full fee, which costs far more than renewing.',
    QLD: 'In Queensland, QBCC charges a restoration fee if your licence lapses, and working while it has lapsed is unlicensed work.',
    WA: {
      builder: 'In WA, a late lodgement fee may apply to builder registrations, so lodge before the expiry date.',
      electrician: 'In WA, an expired electrical licence is restored at the new-application price, which costs more than renewing on time.',
      plumber: "In WA, a lapsed plumbing licence means you can't legally do plumbing work until it's sorted, so renew before the expiry date."
    }[rec.trade],
    SA: 'In South Australia, contractor licences renew every year. Working while your licence has lapsed is unlicensed work, so renew before the expiry date.'
  }[rec.state];
  return {
    subject: (which === 3 ? 'Your licence renewal is due in 3 months' : 'Reminder: your licence expires next month') + ' (' + niceMonth(rec.expiry) + ')',
    text:
`Hi,

Your ${rec.state} ${TRADES[rec.trade].toLowerCase()} licence is due to expire ${when} (${niceMonth(rec.expiry)}).

${lateTip}

Check this year's fee and the best-value term:
${calc}

Step-by-step renewal guide:
${guide}

While you're renewing: most head contractors ask for a current public liability Certificate of Currency. You can compare quotes from several insurers at BizCover (affiliate link, we may earn a commission at no cost to you):
${BIZCOVER}

${which === 3 ? "We'll send one more reminder a month before expiry." : "This is our last reminder for this licence. We'll delete your details after " + niceMonth(rec.expiry) + '. You can sign up again for your next renewal.'}

Unsubscribe and delete your details now:
${unsub}

Trade Licence Calculator AU
${env.SITE_URL}
Operated by Decade Digital HQ, Melbourne. Not affiliated with any government regulator. Always confirm the fee on your official renewal notice.`
  };
}

// ---------- HTTP ----------

async function signup(request, env) {
  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: 'Something went wrong. Please try again.' }); }

  if (clean(form.get('fax_number'), 100)) return json(200, { ok: true, message: 'Check your inbox to confirm.' }); // honeypot

  const email = clean(form.get('email'), 200).toLowerCase();
  const state = STATES[clean(form.get('state'), 5)];
  const trade = TRADES[clean(form.get('trade'), 20)] ? clean(form.get('trade'), 20) : '';
  const expiry = clean(form.get('expiry'), 7);
  const consent = form.get('consent') === 'yes';

  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: 'Please check your email address.' });
  if (!state || !trade) return json(400, { ok: false, error: 'Please choose your state and trade.' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(expiry)) return json(400, { ok: false, error: 'Please choose the month your licence expires.' });
  const now = melbourneNow();
  if (expiry < ym(now) || expiry > ym(addMonths(now, 72))) return json(400, { ok: false, error: 'Please choose an expiry date in the next 6 years.' });
  if (!consent) return json(400, { ok: false, error: 'Please tick the box so we can email you.' });
  if (!env.SMTP2GO_API_KEY || !env.REMINDERS) return json(503, { ok: false, error: "Reminders aren't switched on yet. Please try again soon." });

  const token = crypto.randomUUID().replace(/-/g, '');
  const rec = { email, state, trade, expiry, created: new Date().toISOString(), sent3: false, sent1: false };
  await env.REMINDERS.put('pending:' + token, JSON.stringify(rec), { expirationTtl: 7 * 24 * 3600 });

  const mail = confirmEmail(env, rec, token);
  if (!(await sendMail(env, email, mail.subject, mail.text))) {
    return json(502, { ok: false, error: "That didn't send. Please try again, or email info@tradelicencecalculator.com.au." });
  }
  return json(200, { ok: true, message: 'Nearly done. Check your inbox and click the link to confirm.' });
}

async function confirm(url, env) {
  const t = url.searchParams.get('t') || '';
  if (!/^[a-f0-9]{32}$/.test(t)) return redirect(env, '/reminders?status=invalid');
  const raw = await env.REMINDERS.get('pending:' + t);
  if (!raw) return redirect(env, '/reminders?status=expired');
  const rec = JSON.parse(raw);
  rec.confirmed = new Date().toISOString();
  // Less than 3 months away? Skip the 3-month email; the 1-month one still goes out.
  const now = melbourneNow();
  if (rec.expiry < ym(addMonths(now, 3))) rec.sent3 = true;
  await env.REMINDERS.put('sub:' + rec.expiry + ':' + t, JSON.stringify(rec));
  await env.REMINDERS.delete('pending:' + t);
  return redirect(env, '/reminders?status=confirmed');
}

async function unsubscribe(url, env) {
  const k = url.searchParams.get('k') || '';
  if (!/^sub:\d{4}-\d{2}:[a-f0-9]{32}$/.test(k)) return redirect(env, '/reminders?status=invalid');
  await env.REMINDERS.delete(k);
  return redirect(env, '/reminders?status=unsubscribed');
}

// ---------- Daily reminder run ----------

async function listAll(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.REMINDERS.list({ prefix, cursor });
    keys.push(...page.keys.map(k => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

export async function runReminders(env, date = new Date()) {
  const now = melbourneNow(date);
  const log = { sent: 0, failed: 0, deleted: 0 };

  // 3-month and 1-month reminders.
  for (const [which, ahead, flag] of [[3, 3, 'sent3'], [1, 1, 'sent1']]) {
    for (const key of await listAll(env, 'sub:' + ym(addMonths(now, ahead)) + ':')) {
      const raw = await env.REMINDERS.get(key);
      if (!raw) continue;
      const rec = JSON.parse(raw);
      if (rec[flag]) continue;
      const mail = reminderEmail(env, rec, key, which);
      if (await sendMail(env, rec.email, mail.subject, mail.text)) {
        rec[flag] = true;
        if (which === 1) rec.sent3 = true;
        await env.REMINDERS.put(key, JSON.stringify(rec));
        log.sent++;
      } else {
        log.failed++;
      }
    }
  }

  // Delete records whose expiry month has passed (checks the last 3 months in case a run was missed).
  for (let back = 1; back <= 3; back++) {
    for (const key of await listAll(env, 'sub:' + ym(addMonths(now, -back)) + ':')) {
      await env.REMINDERS.delete(key);
      log.deleted++;
    }
  }
  console.log('reminders', JSON.stringify(log));
  return log;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/remind' && request.method === 'POST') return signup(request, env);
    if (url.pathname === '/api/remind/confirm' && request.method === 'GET') return confirm(url, env);
    if (url.pathname === '/api/remind/unsubscribe' && request.method === 'GET') return unsubscribe(url, env);
    if (url.pathname.startsWith('/api/')) return json(404, { ok: false, error: 'Not found' });
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)));
  }
};
