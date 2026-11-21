# Ship or Skip

An internal tool for deciding whether a feature is worth building. Anyone proposes a feature by describing the problem it solves. Colleagues score it from 1 to 10 on reach, importance, complexity, value and risk. The person who asked gets a combined score and a ship-or-skip call.

Answers are anonymous, and each person can respond once.

## Run

Needs Node 22.13 or later. There are no dependencies to install.

```sh
npm start   # http://localhost:3000
npm test
```

## Configuration

| Variable       | Default               | Purpose |
| -------------- | --------------------- | ------- |
| `PORT`         | `3000`                | Port to listen on. |
| `DB`           | `./ship-or-skip.db`   | Path to the SQLite file. In production, put it on a persistent disk. |
| `EMAIL_DOMAIN` | none                  | When set (for example `yourco.com`), only `@yourco.com` emails can propose or respond. |
| `BASE_URL`     | taken from the request | Public address used in share links, for example `https://ship.yourco.com`. Set it when a proxy rewrites the `Host` header. |

## How it works

- **No accounts.** Each browser gets an anonymous ID cookie. The cookie:
  - limits each browser to one response per proposal,
  - powers the Pending, Responded and Yours tabs,
  - lets the asker reopen their results without the private link.
- **One response per person** is also enforced by email, through a database unique constraint on each proposal. Emails are never shown to anyone, including the asker.
- **Results** are visible only to the asker's browser, or to anyone holding the private results link.
- **Questions** follow RICE (reach, impact, confidence, effort) and Marty Cagan's product risks (value, viability, feasibility): reach, pain, evidence, business value, and build size and risk.
- **Not sure** is allowed on any question, so people don't guess at what they can't judge. Those answers are left out of the averages; each response must score at least one question.
- **Score** is the mean of the five question averages. Build size and risk is inverted (11 − x) because a high score counts against shipping. An overall score of 5.5 or higher means "Ship it."

## Deploying

- **Hosting:** it needs one long-running Node process and a persistent disk for the SQLite file. Serverless hosts (Vercel, Netlify, Lambda) won't work.
- **Access:** there is no login, so keep it off the open internet. Put it behind your VPN or an access gate (Cloudflare Access, Tailscale), and set `EMAIL_DOMAIN`.
- **HTTPS:** serve it through a reverse proxy that sets `X-Forwarded-Proto: https`. The app then marks its cookie `Secure`.
- **Backups:** back up with `sqlite3 ship-or-skip.db ".backup backup.db"` (safe while the app runs), or stream continuous backups with [Litestream](https://litestream.io).

## Project layout

```
server.js         routes, database and HTML views
public/           tokens.css (design tokens), app.css, app.js (copy buttons, submit spinner)
test.js           end-to-end checks against an in-memory database
design.md         the locked design system: read it before changing styles
```
