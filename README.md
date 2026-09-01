# arcade-api

The leaderboard behind [victorsaly.com](https://victorsaly.com)'s games. One Cloudflare
Worker and one D1 table serve every game — a new game is a new key prefix, never new
infrastructure.

**Live at [api.victorsaly.com](https://api.victorsaly.com)**

## Endpoints

| | |
| --- | --- |
| `GET /v1/board?game&mode&period` | The ranking. Public, cached 30s. |
| `POST /v1/score` | Submit a finished game. Signed in, and verified. |
| `GET /v1/me` | Who am I. |
| `PATCH /v1/me` | Change my display name. |
| `DELETE /v1/me` | Erase me and every score I set. |
| `GET /v1/auth/start` | Begin the Google redirect. |
| `GET /v1/auth/callback` | Google returns here. |
| `POST /v1/auth/claim` | Trade the one-time code for a session token. |

Boards are keyed `<game>:<mode>:<period>` — `shutthecube:medium:2026-09-02`,
`beats:color:alltime`. One entry per player per board, and only a better score
replaces it: a leaderboard ranks people, not attempts.

## Scores are checked, not trusted

A board that takes the browser's word for a number is forged within a week, and a
forged board is worse than none — it makes every honest entry meaningless.

Because every ranked game is dealt from a seed, the server can rebuild the board the
player says they played and test the claim against it. [`src/random.js`](src/random.js)
is a mirror of shutTheCube's `src/services/random.js`; if the two ever drift, every
honest score is silently rejected as a forgery, so both repositories pin the same three
generator outputs in their tests.

What [`verify.js`](src/verify.js) does today is structural: the score is in range, the
win flag agrees with it, every move names a tile that was really on that row, and the
moves never add up to more than the score claimed. It does **not** yet replay the full
rule set — runs, wilds, locked tiles, between-turn events — which needs the rules pulled
into a module both the game and this Worker import. Console-editing a score fails today;
someone who studies the rules could still craft a submission.

## Sign-in, without Google's JavaScript

The usual integration drops `accounts.google.com/gsi/client` into the page. These games
load nothing from a CDN at runtime — the 2018 build lost its styling when an unversioned
CDN tag moved, and both games are offline-first PWAs — so this uses the plain redirect
flow instead. The browser goes to Google and comes back; no third-party script is ever
loaded, and the game keeps working with the network off.

The callback hands the browser a **one-time code**, not the session itself: a token in a
redirect URL lands in browser history and in any referrer that follows.

## What is stored about a player

Google's opaque `sub`, and a display name. That is all.

No email — only the `openid` and `profile` scopes are requested, so there is no mailing
list to be tempted by and far less to protect. No avatar, no access or refresh tokens.
`DELETE /v1/me` removes the player and every score, immediately. What is not stored
cannot leak, and it makes the promise on the privacy page trivial to keep.

Display names are editable rather than taken raw from Google, capped at 24 characters,
and screened after folding away the tricks that disguise one word as another — leet
substitution, combining marks, zero-width characters.

## Development

Requires Node 20+.

```bash
npm install
npm test                                  # generator parity, verification, names
npm run dev                               # http://localhost:8787
npm run deploy
```

Secrets for local runs go in `.dev.vars` (copy `.dev.vars.example`); the deployed Worker
reads them from `wrangler secret put` instead. Neither ever belongs in a game's
`.env.local` — those are Vite apps, and Vite bundles its variables into the JavaScript
every player downloads.

The local database is separate from production and starts empty:

```bash
npx wrangler d1 execute arcade --local  --file=./migrations/0001_init.sql
npx wrangler d1 execute arcade --remote --file=./migrations/0001_init.sql
```

To exercise sign-in against a local Worker, add
`http://localhost:8787/v1/auth/callback` as a second authorised redirect URI in the
Google console. The board and score endpoints need no such thing.

## Configuration

| | |
| --- | --- |
| `ALLOWED_ORIGINS` | var — the sites allowed to call this. |
| `GOOGLE_CLIENT_ID` | var — public by design; it travels in every sign-in URL. |
| `GOOGLE_CLIENT_SECRET` | secret |
| `SESSION_SECRET` | secret — signs the session tokens. Changing it signs everyone out. |
| `DB` | D1 binding, database `arcade`. |
