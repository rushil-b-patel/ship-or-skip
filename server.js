// Ship or Skip: colleagues score a proposed feature on five questions; the asker gets a ship-or-skip call.
// Run with `npm start` (Node >= 22.13, no dependencies). Configuration: see README.md.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------- config ----------

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB || path.join(__dirname, 'ship-or-skip.db');
const EMAIL_DOMAIN = (process.env.EMAIL_DOMAIN || '').toLowerCase();
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');

const LIMIT = { title: 90, problem: 4000, email: 254, search: 100, body: 100_000 };
const SHIP_AT = 5.5; // midpoint of the 1–10 scale

// `inverse`: a high score argues against shipping, so the summary flips it (11 - x).
const QUESTIONS = [
  { id: 'reach', text: 'How many of our users would use this?', lo: 'Very few', hi: 'Almost all of them' },
  { id: 'pain', text: 'How painful is this problem for them today?', lo: 'A minor annoyance', hi: 'It blocks their work' },
  { id: 'evidence', text: 'How sure are we that users really need this?', lo: 'It’s a hunch', hi: 'Strong proof (data, repeated requests)' },
  { id: 'business', text: 'How much would it help the business (revenue, retention, strategy)?', lo: 'Not at all', hi: 'A great deal' },
  { id: 'cost', text: 'How big and risky is it to build and maintain?', lo: 'Small and safe', hi: 'Big and risky', inverse: true },
];
const UNSURE = 'unsure';
const SCORE_COLUMNS = QUESTIONS.map(q => q.id).join(', ');

// ---------- database ----------

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    problem TEXT NOT NULL,
    author TEXT NOT NULL,
    key TEXT NOT NULL,            -- secret in the asker's private results link
    owner TEXT NOT NULL,          -- asker's browser, so they see results without the link
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id),
    email TEXT NOT NULL,
    voter TEXT NOT NULL,
    -- one score column per question; NULL means "Not sure"
    ${QUESTIONS.map(q => `${q.id} INTEGER CHECK (${q.id} BETWEEN 1 AND 10),`).join('\n    ')}
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (proposal_id, email),  -- one response per person (email is never shown, only used for this)...
    UNIQUE (proposal_id, voter)   -- ...and per browser
  );
`);

const sql = {
  // ponytail: no pagination, LIKE scan. Add LIMIT/OFFSET (and FTS5 for search) once the list runs past a few hundred proposals.
  search: db.prepare(`
    SELECT p.*, COUNT(r.id) AS n FROM proposals p
    LEFT JOIN responses r ON r.proposal_id = p.id
    WHERE p.title || ' ' || p.problem || ' ' || p.author LIKE ? ESCAPE '\\'
    GROUP BY p.id ORDER BY p.id DESC`),
  proposal: db.prepare('SELECT * FROM proposals WHERE id = ?'),
  addProposal: db.prepare('INSERT INTO proposals (title, problem, author, key, owner) VALUES (?, ?, ?, ?, ?)'),
  answeredBy: db.prepare('SELECT proposal_id FROM responses WHERE voter = ?'),
  hasAnswered: db.prepare('SELECT 1 FROM responses WHERE proposal_id = ? AND voter = ?'),
  scores: db.prepare(`SELECT ${SCORE_COLUMNS} FROM responses WHERE proposal_id = ?`), // scores only: who answered never leaves the database
  addResponse: db.prepare(`INSERT INTO responses (proposal_id, email, voter, ${SCORE_COLUMNS}) VALUES (?, ?, ?, ${QUESTIONS.map(() => '?')})`),
};

// ---------- helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmtDate = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const likePattern = q => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

function checkEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length > LIMIT.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [email, 'That isn’t an email address. Use your work email.'];
  if (EMAIL_DOMAIN && !email.endsWith('@' + EMAIL_DOMAIN)) return [email, `Only @${EMAIL_DOMAIN} addresses can take part. Use your work email.`];
  return [email, null];
}

function keyMatches(given, real) {
  const a = Buffer.from(String(given || '')), b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// "Not sure" answers (NULL) are left out of every average; a question nobody could judge drops out of the overall score.
function summarize(rows) {
  const questions = QUESTIONS.map(q => {
    const scores = rows.map(r => r[q.id]).filter(v => v != null);
    return { ...q, answered: scores.length, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
  });
  const judged = questions.filter(q => q.avg != null);
  const overall = judged.reduce((s, q) => s + (q.inverse ? 11 - q.avg : q.avg), 0) / judged.length;
  return { n: rows.length, questions, overall, ship: overall >= SHIP_AT, close: Math.abs(overall - SHIP_AT) < 0.5 };
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > LIMIT.body) throw Object.assign(new Error('Form too large'), { status: 413 });
  }
  return Object.fromEntries(new URLSearchParams(body));
}

// ---------- static assets ----------

const STATIC = {};
for (const [file, type] of [
  ['tokens.css', 'text/css; charset=utf-8'],
  ['app.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['icon.svg', 'image/svg+xml'],
  ['favicon.ico', 'image/x-icon'],
  ['apple-touch-icon.png', 'image/png'],
]) {
  const body = fs.readFileSync(path.join(__dirname, 'public', file));
  const version = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
  STATIC['/' + file] = { body, version, type };
}
const asset = file => `/${file}?v=${STATIC['/' + file].version}`;

// ---------- views ----------

const layout = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${esc(title)} · ` : ''}Ship or Skip</title>
<link rel="icon" href="${asset('favicon.ico')}" sizes="32x32">
<link rel="icon" href="${asset('icon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${asset('apple-touch-icon.png')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600&family=Geist:wght@400;600&family=Geist+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${asset('tokens.css')}">
<link rel="stylesheet" href="${asset('app.css')}">
<script src="${asset('app.js')}" defer></script>
</head>
<body>
<header class="nav">
  <a class="wordmark" href="/"><img class="wordmark__mark" src="${asset('icon.svg')}" alt="">Ship or Skip</a>
  <nav class="nav__links" aria-label="Primary">
    <a class="nav__link" href="/">Proposals</a>
    <a class="btn btn--outline" href="/new">New proposal</a>
  </nav>
</header>
<main class="page">${body}</main>
<footer class="foot">
  <p class="wordmark"><img class="wordmark__mark" src="${asset('icon.svg')}" alt="">Ship or Skip</p>
  <p class="foot__note">Answers are anonymous: the asker sees only the combined result. One response per person.</p>
</footer>
</body>
</html>`;

const describedBy = (name, err) => `aria-describedby="${name}-help"${err ? ' aria-invalid="true"' : ''}`;
const input = (name, value, err, attrs) => `<input class="input" id="${name}" name="${name}" value="${esc(value)}" ${describedBy(name, err)} ${attrs}>`;
const textarea = (name, value, err, attrs) => `<textarea class="input" id="${name}" name="${name}" ${describedBy(name, err)} ${attrs}>${esc(value)}</textarea>`;
const help = (id, text, err) => `<p class="field__help" id="${id}"${err ? ' data-error role="alert"' : ''}>${err ? esc(err) : text}</p>`;
const field = (name, label, text, err, control) => `
  <div class="field">
    <label class="field__label" for="${name}">${label}</label>
    ${control}
    ${help(`${name}-help`, text, err)}
  </div>`;
const emailInput = (v, err) => input('email', v.email, err.email, `type="email" required maxlength="${LIMIT.email}" autocomplete="email"`);
const formError = err => Object.keys(err).length
  ? `<p class="form__error" role="alert">${esc(err.form || 'Some answers need fixing. See the notes above.')}</p>` : '';
const submit = label => `<button class="btn" type="submit">${label}</button>`;

const byline = p => `<p class="byline">Asked by ${esc(p.author)} on ${fmtDate(p.created_at)}</p>`;

// `title` and `text` are trusted HTML: callers escape any user input they pass in.
const notice = (title, text, action = '') => `
  <section class="notice">
    <h2 class="notice__title">${title}</h2>
    <p>${text}</p>
    ${action}
  </section>`;
const backLink = '<a href="/">Back to all proposals</a>';
const proposeButton = '<a class="btn" href="/new">Propose a feature</a>';

const diptych = (p, work) => `
  <div class="diptych">
    <aside class="brief">
      <h1 class="brief__title">${esc(p.title)}</h1>
      ${byline(p)}
      <p class="brief__problem">${esc(p.problem)}</p>
    </aside>
    <div>${work}</div>
  </div>`;

const TABS = { pending: 'Pending', responded: 'Responded', yours: 'Yours' };

function indexPage(voter, params) {
  const tab = Object.hasOwn(TABS, params.get('tab')) ? params.get('tab') : 'pending';
  const q = (params.get('q') || '').trim().slice(0, LIMIT.search);
  const rows = sql.search.all(likePattern(q));
  if (!rows.length && !q) {
    return layout('', notice('No proposals yet.', 'A proposal is a feature someone wants a ship-or-skip read on before it gets built.', proposeButton));
  }

  const answered = new Set(sql.answeredBy.all(voter).map(r => r.proposal_id));
  const lists = { pending: [], responded: [], yours: [] };
  for (const p of rows) lists[p.owner === voter ? 'yours' : answered.has(p.id) ? 'responded' : 'pending'].push(p);

  const tabHref = t => `/?${new URLSearchParams(q ? { tab: t, q } : { tab: t })}`;
  const tabLink = t => `
      <a class="tab" href="${esc(tabHref(t))}"${t === tab ? ' aria-current="page"' : ''}>${TABS[t]} <span class="tab__count">${lists[t].length}</span></a>`;

  const row = p => `
    <li class="ledger__row">
      <div class="ledger__main">
        <h2 class="ledger__title"><a href="/p/${p.id}">${esc(p.title)}</a></h2>
        <p class="ledger__problem">${esc(p.problem)}</p>
        <p class="ledger__meta">
          <span>${esc(p.author)}</span>
          <span>${fmtDate(p.created_at)}</span>
          ${p.owner === voter ? `<a class="ledger__action" href="/p/${p.id}/results">Your results</a>` : ''}
        </p>
      </div>
      <p class="ledger__count"><span class="ledger__num">${p.n}</span>${p.n === 1 ? 'response' : 'responses'}</p>
    </li>`;

  const shown = lists[tab];
  const list = shown.length ? `<ol class="ledger">${shown.map(row).join('')}
  </ol>`
    : q ? notice(`Nothing in ${TABS[tab]} matches “${esc(q)}”.`, 'Try another word, or check the other tabs.', `<a href="/?tab=${tab}">Clear search</a>`)
    : tab === 'pending' ? notice('You’re all caught up.', 'You’ve responded to every proposal. New ones show up here.')
    : tab === 'responded' ? notice('Nothing here yet.', 'Proposals you respond to move here.', '<a href="/">See pending proposals</a>')
    : notice('You haven’t asked anything from this browser.',
      'Proposals you create here show up in this tab. Asked from another browser? Its private results link still works.', proposeButton);

  return layout('', `
  <section class="intro">
    <h1 class="intro__title">Features waiting on a ship-or-skip call.</h1>
    <p class="intro__text">Pick one and score it on five questions. About a minute. Answers are anonymous: the person who asked sees only the combined result.</p>
  </section>
  <div class="toolbar">
    <nav class="tabs" aria-label="Filter proposals">${Object.keys(TABS).map(tabLink).join('')}
    </nav>
    <form class="search" role="search" method="get" action="/">
      <input type="hidden" name="tab" value="${tab}">
      <label class="sr-only" for="q">Search proposals</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" maxlength="${LIMIT.search}" placeholder="Search proposals">
      <button class="btn btn--outline" type="submit">Search</button>
    </form>
  </div>
  <div class="ledger-wrap">${list}</div>`);
}

function newPage(v = {}, err = {}) {
  return layout('New proposal', `
  <section class="sheet">
    <h1 class="sheet__title">Propose a feature</h1>
    <p class="sheet__lede">Describe the problem, not the solution. Colleagues score it on reach, pain, evidence, business value and cost. You get the combined score and a ship-or-skip call, never who answered.</p>
    <form class="form" method="post" action="/new">
      ${field('title', 'Feature', 'A short name, like “Bulk export invoices to CSV”.', err.title,
        input('title', v.title, err.title, `required maxlength="${LIMIT.title}" autocomplete="off"`))}
      ${field('problem', 'The problem it solves', 'Who has the problem, and what do they do today without this?', err.problem,
        textarea('problem', v.problem, err.problem, `required maxlength="${LIMIT.problem}" rows="6"`))}
      ${field('email', 'Your work email', 'Shown to respondents as the person asking.', err.email, emailInput(v, err))}
      ${formError(err)}
      ${submit('Ask for feedback')}
    </form>
  </section>`);
}

function proposalPage(p, voter, v = {}, err = {}) {
  const ownerNote = p.owner === voter ? `<p class="owner-note">You asked this. <a href="/p/${p.id}/results">See your results</a></p>` : '';
  if (sql.hasAnswered.get(p.id, voter)) {
    return layout(p.title, ownerNote + diptych(p, notice('You’ve responded to this one.',
      `Your ratings were added anonymously to ${esc(p.author)}’s results. Each person gets one response per proposal.`, backLink)));
  }

  const choice = (q, value, label, cls = 'choice') => `
          <label class="${cls}"><input type="radio" name="${q.id}" value="${value}" required${v[q.id] === String(value) ? ' checked' : ''}><span>${label}</span></label>`;
  const scale = q => `
    <li>
      <fieldset class="q" aria-describedby="${q.id}-ends">
        <legend class="q__text">${q.text}</legend>
        <div class="scale">${Array.from({ length: 10 }, (_, i) => choice(q, i + 1, i + 1)).join('')}
        </div>
        <p class="scale__ends" id="${q.id}-ends"><span>1 = ${q.lo}</span><span>10 = ${q.hi}</span></p>
        ${choice(q, UNSURE, 'Not sure', 'choice choice--unsure')}
        ${err[q.id] ? help(`${q.id}-err`, '', err[q.id]) : ''}
      </fieldset>
    </li>`;

  return layout(p.title, ownerNote + diptych(p, `
  <form class="form" method="post" action="/p/${p.id}">
    <ol class="questions">${QUESTIONS.map(scale).join('')}</ol>
    ${field('email', 'Your work email', 'Only used to keep it to one response per person. The asker never sees who answered.', err.email, emailInput(v, err))}
    ${formError(err)}
    ${submit('Send response')}
  </form>`));
}

function resultsPage(p, origin) {
  const copyField = (id, label, srName, value, helpText = '') => `
    <div class="field">
      <label class="field__label" for="${id}">${label}</label>
      <div class="copy-field">
        <input class="input" id="${id}" readonly value="${esc(value)}"${helpText ? ` aria-describedby="${id}-help"` : ''}>
        <button class="copy-btn" type="button" data-copy="${id}"><span aria-live="polite">Copy</span><span class="sr-only"> ${srName}</span></button>
      </div>
      ${helpText ? `<p class="field__help" id="${id}-help">${helpText}</p>` : ''}
    </div>`;
  const share = `
  <section class="share">
    ${copyField('share-link', 'Send this link to colleagues', 'colleague link', `${origin}/p/${p.id}`)}
    ${copyField('private-link', 'Your private results link', 'private results link', `${origin}/p/${p.id}/results?key=${p.key}`,
      'Bookmark it. Anyone with this link can see the results; this browser remembers you without it.')}
  </section>`;

  const head = `
  <header class="report-head">
    <h1 class="report-head__title">${esc(p.title)}</h1>
    ${byline(p)}
    <details class="problem-toggle"><summary>The problem</summary><p>${esc(p.problem)}</p></details>
  </header>`;

  const rows = sql.scores.all(p.id);
  if (!rows.length) {
    return layout(`Results: ${p.title}`, head + notice('No responses yet.', 'Send the colleague link below. Answers show up here as they arrive.') + share);
  }

  const s = summarize(rows);
  const unsureNote = s.questions.some(q => q.answered < s.n) ? ' Not sure answers are left out.' : '';
  return layout(`Results: ${p.title}`, `${head}
  <section class="verdict">
    <h2 class="call" data-call="${s.ship ? 'ship' : 'skip'}">${s.ship ? 'Ship it.' : 'Don’t ship it.'}</h2>
    <div class="verdict__detail">
      <p class="score"><span class="score__num">${s.overall.toFixed(1)}</span><span class="score__of"> / 10</span></p>
      <p class="score__caption">Averaged over ${plural(s.n, 'response', 'responses')}. ${SHIP_AT} or higher means ship; build size and risk count against it.${unsureNote}${s.close ? ' This one is a close call.' : ''}</p>
    </div>
  </section>
  <section class="breakdown">
    <h2 class="section-title">By question</h2>
    <table class="scores">
      <thead><tr><th scope="col">Question</th><th scope="col">Average</th></tr></thead>
      <tbody>${s.questions.map(q => `
        <tr>
          <th scope="row">${q.text}${q.inverse ? '<span class="scores__note">Lower is better</span>' : ''}${q.answered < s.n ? `<span class="scores__note">${s.n - q.answered} not sure</span>` : ''}</th>
          <td>${q.avg == null ? '—' : `<span class="bar" style="--v: ${(q.avg / 10).toFixed(3)}" aria-hidden="true"></span>${q.avg.toFixed(1)}`}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>
  ${share}`);
}

const deniedPage = () => layout('Private results', notice('These results are private.',
  'Only the person who asked can see them. If that’s you, open the private link you got when you created the proposal.', backLink));

const notFoundPage = () => layout('Not found', notice('Nothing at this address.',
  'The link may be mistyped, or the proposal no longer exists.', backLink));

const errorPage = () => layout('Error', notice('That didn’t go through.',
  'The server hit an error saving this. Go back and try again; your answers should still be in the form.', backLink));

// ---------- HTTP ----------

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'", // inline only for the score bars' style="--v"
    'font-src https://fonts.gstatic.com',
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin', // keeps the private ?key= out of Referer headers sent to other sites
};

function handleNewProposal(f, voter) {
  const title = (f.title || '').trim(), problem = (f.problem || '').trim();
  const [email, emailErr] = checkEmail(f.email);
  const err = {};
  if (!title) err.title = 'Give the feature a short name.';
  else if (title.length > LIMIT.title) err.title = `Keep the name under ${LIMIT.title} characters. Put the detail in the problem.`;
  if (!problem) err.problem = 'Describe the problem so colleagues can judge it.';
  else if (problem.length > LIMIT.problem) err.problem = `Keep it under ${LIMIT.problem.toLocaleString('en')} characters.`;
  if (emailErr) err.email = emailErr;
  if (Object.keys(err).length) return { status: 422, html: newPage(f, err) };

  const key = crypto.randomBytes(18).toString('base64url');
  const { lastInsertRowid } = sql.addProposal.run(title, problem, email, key, voter);
  return { redirect: `/p/${lastInsertRowid}/results?key=${key}` };
}

function handleResponse(p, f, voter) {
  const [email, emailErr] = checkEmail(f.email);
  const err = {};
  for (const q of QUESTIONS) if (f[q.id] !== UNSURE && !/^([1-9]|10)$/.test(f[q.id] || '')) err[q.id] = 'Pick a score from 1 to 10, or Not sure.';
  if (!Object.keys(err).length && QUESTIONS.every(q => f[q.id] === UNSURE)) err.form = 'Score at least one question. Use Not sure only for the ones you can’t judge.';
  if (emailErr) err.email = emailErr;
  if (Object.keys(err).length) return { status: 422, html: proposalPage(p, voter, f, err) };

  try {
    sql.addResponse.run(p.id, email, voter, ...QUESTIONS.map(q => f[q.id] === UNSURE ? null : Number(f[q.id])));
  } catch (e) {
    if (!/UNIQUE/.test(e.message)) throw e;
    if (/\.email/.test(e.message)) {
      return { status: 409, html: proposalPage(p, voter, f, { email: `${email} has already responded to this proposal. Each person gets one response.` }) };
    }
    // Same browser already responded: the redirect shows that state.
  }
  return { redirect: `/p/${p.id}` };
}

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  const send = (status, html) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  };
  const reply = r => {
    if (!r.redirect) return send(r.status, r.html);
    res.writeHead(303, { Location: r.redirect });
    res.end();
  };

  try {
    const url = new URL(req.url, 'http://localhost');
    const file = STATIC[url.pathname];
    if (file) {
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(file.body);
    }

    if (req.method === 'POST' && req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Cross-site form submissions are not allowed.');
    }

    // Anonymous per-browser id: backs the one-response rule, the home tabs and the asker's results access.
    const cookie = /(?:^|;\s*)voter=([\w-]{36})/.exec(req.headers.cookie || '');
    const voter = cookie ? cookie[1] : crypto.randomUUID();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    if (!cookie) res.setHeader('Set-Cookie', `voter=${voter}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);

    if (url.pathname === '/') return send(200, indexPage(voter, url.searchParams));

    if (url.pathname === '/new') {
      if (req.method !== 'POST') return send(200, newPage());
      return reply(handleNewProposal(await readForm(req), voter));
    }

    const m = /^\/p\/(\d+)(\/results)?$/.exec(url.pathname);
    const p = m && sql.proposal.get(Number(m[1]));
    if (!p) return send(404, notFoundPage());

    if (m[2]) {
      if (p.owner !== voter && !keyMatches(url.searchParams.get('key'), p.key)) return send(403, deniedPage());
      const origin = BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      return send(200, resultsPage(p, origin));
    }

    if (req.method !== 'POST') return send(200, proposalPage(p, voter));
    return reply(handleResponse(p, await readForm(req), voter));
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(e.status || 500, errorPage());
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Ship or Skip listening on http://localhost:${PORT}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(() => { db.close(); process.exit(0); }));
  }
}

module.exports = { server, summarize };
