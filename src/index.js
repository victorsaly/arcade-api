/**
 * The arcade API: one Worker and one D1 table serving every game.
 *
 * Endpoints
 *   GET  /v1/board?game&mode&period   the ranking, public
 *   POST /v1/score                    submit a finished game, signed in
 *   GET  /v1/me                       who am I, and where do I rank
 *   PATCH/v1/me                       change my display name
 *   DELETE /v1/me                     erase me and every score I set
 *   GET  /v1/auth/start               begin the Google redirect
 *   GET  /v1/auth/callback            Google returns here
 *   POST /v1/auth/claim               trade the one-time code for a session
 *   POST /v1/auth/apple               sign in with an Apple identity token
 *
 * The games stay entirely playable when this is unreachable. Nothing here is
 * on the critical path of a game of dice.
 */

import { authorizeUrl, exchangeCode, mintSession, randomId, readSession } from './auth.js'
import { appleKeyFrom, appleRefreshToken, revokeApple, verifyAppleIdentity } from './apple.js'
import { allowedRedirect, listOf, withCode } from './redirects.js'
import { cleanName } from './names.js'
import { verify } from './verify.js'
import { verifyBeats } from './beats.js'

const CORS = (origin, allowed) => ({
  'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0],
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-max-age': '86400',
  vary: 'origin'
})

/**
 * A redirect we are still allowed to add headers to.
 *
 * `Response.redirect()` returns a response whose headers are immutable, so the
 * CORS pass afterwards throws and every sign-in turns into a 500.
 */
const redirect = (location) =>
  new Response(null, { status: 302, headers: { location } })

const json = (data, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })

const origins = (env) => listOf(env.ALLOWED_ORIGINS ?? 'https://shutthecube.com')

/*
 * The installed apps. Their pages are served from inside the app, so their
 * origin is the wrapper's (`capacitor://localhost` on iOS, `https://localhost`
 * on Android) and they may call the API; but neither is a place a sign-in may
 * be sent back to. An app is returned to through its own address instead.
 */
const appOrigins = (env) => listOf(env.APP_ORIGINS)
const appRedirects = (env) => listOf(env.APP_REDIRECTS)

/** `<game>:<mode>:<period>`, and nothing that is not exactly that. */
const boardKey = (game, mode, period) => {
  const safe = /^[a-z0-9-]{1,32}$/
  const stamp = /^(alltime|\d{4}-\d{2}-\d{2})$/
  if (!safe.test(game) || !safe.test(mode) || !stamp.test(period)) return null
  return `${game}:${mode}:${period}`
}

const now = () => Math.floor(Date.now() / 1000)

const playerFrom = async (request, env) => {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const id = await readSession(token, env.SESSION_SECRET)
  if (!id) return null
  return env.DB.prepare('SELECT id, name, sub, apple_refresh FROM players WHERE id = ?')
    .bind(id)
    .first()
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('origin') ?? ''
    const cors = CORS(origin, [...origins(env), ...appOrigins(env)])

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      const response = await route(request, env, url)
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v)
      return response
    } catch (error) {
      // Never hand an internal message to a caller; the game only needs to
      // know the board is unavailable so it can hide it.
      console.error('arcade-api', error?.stack ?? error)
      return json({ error: 'unavailable' }, { status: 500, headers: cors })
    }
  }
}

async function route(request, env, url) {
  const { pathname } = url
  const method = request.method

  // ---------------------------------------------------------------- board

  if (method === 'GET' && pathname === '/v1/board') {
    const board = boardKey(
      url.searchParams.get('game') ?? '',
      url.searchParams.get('mode') ?? '',
      url.searchParams.get('period') ?? ''
    )
    if (!board) return json({ error: 'bad board' }, { status: 400 })
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)))
    const game = url.searchParams.get('game')
    const mode = url.searchParams.get('mode')

    /*
     * All-time totals every daily a player has finished in this mode.
     *
     * Ranking by best-ever score would saturate: Medium tops out at 405 and
     * shutting the box is achievable, so the head of the table becomes a pile
     * of ties. A running total does not tie, and it rewards turning up, which
     * is what the daily is for.
     *
     * The prefix is matched as a range rather than with LIKE so the
     * (board, score) index can serve it.
     */
    const alltime = url.searchParams.get('period') === 'alltime'
    const prefix = `${game}:${mode}:`
    const { results } = alltime
      ? await env.DB.prepare(
          `SELECT p.name AS name,
                  SUM(s.score) AS score,
                  COUNT(*)     AS days,
                  SUM(s.won)   AS shut,
                  MAX(s.score) AS best,
                  MIN(s.created_at) AS created_at
             FROM scores s JOIN players p ON p.id = s.player_id
            WHERE s.board >= ? AND s.board < ?
            GROUP BY s.player_id
            ORDER BY score DESC, days ASC
            LIMIT ?`
        )
          .bind(prefix, `${prefix}￿`, limit)
          .all()
      : await env.DB.prepare(
          `SELECT p.name AS name, s.score, s.won, s.rolls, s.created_at
             FROM scores s JOIN players p ON p.id = s.player_id
            WHERE s.board = ?
            ORDER BY s.score DESC, s.created_at ASC
            LIMIT ?`
        )
          .bind(board, limit)
          .all()

    return json(
      { board, entries: (results ?? []).map((r, i) => ({ rank: i + 1, ...r })) },
      // A leaderboard may be a few seconds stale; it must not cost a query per
      // viewer per refresh.
      { headers: { 'cache-control': 'public, max-age=30' } }
    )
  }

  // ---------------------------------------------------------------- score

  if (method === 'POST' && pathname === '/v1/score') {
    const player = await playerFrom(request, env)
    if (!player) return json({ error: 'sign in first' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) return json({ error: 'bad request' }, { status: 400 })

    const { game, mode, period, seed, score, won, turns, proof } = body
    const board = boardKey(String(game ?? ''), String(mode ?? ''), String(period ?? ''))
    if (!board) return json({ error: 'bad board' }, { status: 400 })
    // Only a seeded game can be verified, so only a seeded game can be ranked.
    if (!Number.isFinite(Number(seed))) {
      return json({ error: 'unranked game' }, { status: 400 })
    }

    /*
     * The score is replayed, not believed: each game's checker rebuilds the
     * challenge from the seed and works the score out for itself, comparing
     * the claim only against its own answer.
     *
     * A game with no checker cannot be ranked. That is the rule that keeps
     * this honest as more games arrive: adding a board is adding a way to
     * verify it, not just a new key prefix.
     */
    const checked =
      game === 'shutthecube'
        ? verify({
            modeKey: String(mode),
            seed: Number(seed),
            score: Number(score),
            won: Boolean(won),
            turns
          })
        : game === 'beats'
          ? verifyBeats({
              modeKey: String(mode),
              seed: Number(seed),
              score: Number(score),
              proof
            })
          : { ok: false, reason: 'no checker for that game' }
    if (!checked.ok) {
      console.warn('rejected score', board, player.id, checked.reason)
      return json({ error: 'that score does not check out' }, { status: 422 })
    }

    // One entry per player per board, and only an improvement replaces it.
    await env.DB.prepare(
      `INSERT INTO scores (board, player_id, score, won, rolls, seed, proof, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(board, player_id) DO UPDATE SET
         score = excluded.score, won = excluded.won, rolls = excluded.rolls,
         proof = excluded.proof, created_at = excluded.created_at
       WHERE excluded.score > scores.score`
    )
      .bind(
        board,
        player.id,
        checked.score,
        checked.won ? 1 : 0,
        checked.rolls,
        Number(seed) >>> 0,
        JSON.stringify(turns ?? proof ?? []).slice(0, 20000),
        now()
      )
      .run()

    const rank = await env.DB.prepare(
      `SELECT COUNT(*) + 1 AS rank FROM scores
        WHERE board = ? AND score > (SELECT score FROM scores WHERE board = ? AND player_id = ?)`
    )
      .bind(board, board, player.id)
      .first()

    return json({ ok: true, rank: rank?.rank ?? null })
  }

  // ------------------------------------------------------------------- me

  if (pathname === '/v1/me') {
    const player = await playerFrom(request, env)
    if (!player) return json({ error: 'sign in first' }, { status: 401 })

    if (method === 'GET') return json({ id: player.id, name: player.name })

    if (method === 'PATCH') {
      const body = await request.json().catch(() => null)
      const checked = cleanName(body?.name)
      if (!checked.ok) return json({ error: checked.reason }, { status: 400 })
      await env.DB.prepare('UPDATE players SET name = ?, updated_at = ? WHERE id = ?')
        .bind(checked.name, now(), player.id)
        .run()
      return json({ ok: true, name: checked.name })
    }

    if (method === 'DELETE') {
      // Everything, immediately, with no "are you sure" on the server side.
      // The promise on the privacy page is only worth what this does.
      // A player who came in through Apple is also signed out of the app at
      // Apple's end, as Apple requires. The erasure below does not wait on
      // it: if Apple cannot be reached, the data here still goes.
      const key = appleKeyFrom(env)
      if (key && player.apple_refresh) {
        await revokeApple({
          refreshToken: player.apple_refresh,
          clientId: listOf(env.APPLE_AUDIENCES)[0],
          key
        })
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM scores WHERE player_id = ?').bind(player.id),
        env.DB.prepare('DELETE FROM handoffs WHERE player_id = ?').bind(player.id),
        env.DB.prepare('DELETE FROM players WHERE id = ?').bind(player.id)
      ])
      return json({ ok: true })
    }
  }

  // ----------------------------------------------------------------- auth

  if (method === 'GET' && pathname === '/v1/auth/start') {
    const back = url.searchParams.get('redirect') ?? origins(env)[0]
    if (!allowedRedirect(back, { origins: origins(env), appRedirects: appRedirects(env) })) {
      return json({ error: 'bad redirect' }, { status: 400 })
    }
    const state = randomId()
    await env.DB.prepare('INSERT INTO auth_states (state, redirect, expires_at) VALUES (?, ?, ?)')
      .bind(state, back, now() + 600)
      .run()
    return redirect(
      authorizeUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: `${url.origin}/v1/auth/callback`,
        state
      })
    )
  }

  if (method === 'GET' && pathname === '/v1/auth/callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) return json({ error: 'bad callback' }, { status: 400 })

    const row = await env.DB.prepare(
      'SELECT redirect, expires_at FROM auth_states WHERE state = ?'
    )
      .bind(state)
      .first()
    await env.DB.prepare('DELETE FROM auth_states WHERE state = ?').bind(state).run()
    if (!row || row.expires_at < now()) return json({ error: 'expired' }, { status: 400 })

    const identity = await exchangeCode({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/v1/auth/callback`
    })
    if (!identity) return json({ error: 'sign in failed' }, { status: 400 })

    const player = await playerFor(env, identity)

    // Hand back a one-time code rather than the session itself: a token in a
    // redirect URL lands in browser history, and in any referrer that follows.
    const handoff = randomId()
    await env.DB.prepare('INSERT INTO handoffs (code, player_id, expires_at) VALUES (?, ?, ?)')
      .bind(handoff, player.id, now() + 120)
      .run()
    return redirect(withCode(row.redirect, handoff))
  }

  if (method === 'POST' && pathname === '/v1/auth/claim') {
    const body = await request.json().catch(() => null)
    const code = body?.code
    if (typeof code !== 'string') return json({ error: 'bad request' }, { status: 400 })

    const row = await env.DB.prepare(
      'SELECT player_id, expires_at FROM handoffs WHERE code = ?'
    )
      .bind(code)
      .first()
    // One use only, whether or not it turns out to be valid.
    await env.DB.prepare('DELETE FROM handoffs WHERE code = ?').bind(code).run()
    if (!row || row.expires_at < now()) return json({ error: 'expired' }, { status: 400 })

    const player = await env.DB.prepare('SELECT id, name FROM players WHERE id = ?')
      .bind(row.player_id)
      .first()
    if (!player) return json({ error: 'expired' }, { status: 400 })

    return json({
      token: await mintSession(player.id, env.SESSION_SECRET),
      name: player.name
    })
  }

  if (method === 'POST' && pathname === '/v1/auth/apple') {
    const audiences = listOf(env.APPLE_AUDIENCES)
    // Not configured means not offered, rather than a sign-in that can never work.
    if (audiences.length === 0) return json({ error: 'not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const identity = await verifyAppleIdentity(body?.identityToken, { audiences })
    if (!identity) return json({ error: 'sign in failed' }, { status: 400 })

    // Apple gives the name to the device once, on the first sign-in, and never
    // to us; the app passes it along and it is only ever a suggestion.
    const player = await playerFor(env, { ...identity, name: body?.name })

    // The code that came with the sign-in buys the one token kept for this
    // player, so that deleting the account can revoke it at Apple too.
    const key = appleKeyFrom(env)
    if (key && typeof body?.authorizationCode === 'string') {
      const refresh = await appleRefreshToken({
        code: body.authorizationCode,
        clientId: identity.aud,
        key
      })
      if (refresh) {
        await env.DB.prepare('UPDATE players SET apple_refresh = ? WHERE id = ?')
          .bind(refresh, player.id)
          .run()
      }
    }
    const row = await env.DB.prepare('SELECT id, name FROM players WHERE id = ?')
      .bind(player.id)
      .first()
    return json({ token: await mintSession(row.id, env.SESSION_SECRET), name: row.name })
  }

  return json({ error: 'not found' }, { status: 404 })
}

/** The player behind an identity, created on their first sign-in. */
async function playerFor(env, identity) {
  const existing = await env.DB.prepare('SELECT id FROM players WHERE sub = ?')
    .bind(identity.sub)
    .first()
  if (existing) return existing
  const suggested = cleanName(identity.name ?? '')
  const id = randomId(12)
  await env.DB.prepare(
    'INSERT INTO players (id, sub, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, identity.sub, suggested.ok ? suggested.name : 'Player', now(), now())
    .run()
  return { id }
}
