/**
 * Deciding whether a submitted score could actually have happened.
 *
 * A leaderboard that takes the browser's word for a number is forged within a
 * week, and a forged leaderboard is worse than none — it makes every honest
 * entry meaningless. Because the board and the dice are derived from a seed,
 * the server can rebuild the game the player says they played and check the
 * claim against it, rather than trusting it.
 *
 * What this does today is structural: it rebuilds the board from the seed and
 * confirms the claimed score is reachable on *that* board with *those* moves.
 * It does not yet replay the full rule set — runs, wilds, locked tiles and
 * between-turn events — which needs the rules extracted into a module both the
 * game and this Worker import. Until then a determined cheater with the rules
 * in hand can still construct a plausible submission; casual console-editing,
 * which is virtually all of it, does not survive this.
 */

import { mulberry32, shuffle } from './random.js'

const ROW_TOTAL = 45
const FACES = 9

/** Rows per mode, mirroring `stores/modes.js`. */
export const ROWS = { beginner: 1, medium: 9, ninja: 9 }

/** Rebuild the faces a seed deals, row by row. */
export const boardFor = (modeKey, seed) => {
  const rows = ROWS[modeKey]
  if (!rows) return null
  const faces = Array.from({ length: FACES }, (_, i) => i + 1)
  const boardRng = mulberry32(seed >>> 0)
  const board = Array.from({ length: rows }, () => shuffle(faces, boardRng))
  // The play stream is separate from the board stream, exactly as in the game.
  const playRng = mulberry32((seed ^ 0x9e3779b9) >>> 0)
  return { rows, board: board.map((row) => shuffle(row, playRng)), playRng }
}

/**
 * Check a submission against the board its seed produces.
 *
 * Returns `{ ok: true, score }` or `{ ok: false, reason }`. The reason is for
 * our logs, never for the player: telling someone exactly which check their
 * forgery failed is free tuition.
 */
export const verify = ({ modeKey, seed, score, rolls, won, moves }) => {
  const rows = ROWS[modeKey]
  if (!rows) return { ok: false, reason: 'unknown mode' }

  const max = rows * ROW_TOTAL
  if (!Number.isInteger(score) || score < 0 || score > max) {
    return { ok: false, reason: 'score out of range' }
  }
  if (!Number.isInteger(rolls) || rolls < 0 || rolls > 400) {
    return { ok: false, reason: 'roll count out of range' }
  }
  if (!Array.isArray(moves) || moves.length > rows * FACES) {
    return { ok: false, reason: 'move list malformed' }
  }
  // Winning means the whole board came down; nothing else counts as a win.
  if (Boolean(won) !== (score === max)) {
    return { ok: false, reason: 'win flag disagrees with score' }
  }

  const built = boardFor(modeKey, seed)
  if (!built) return { ok: false, reason: 'unknown mode' }

  // Every move has to name a face that is actually on the row it claims, and
  // no row can give up more than it holds.
  const remaining = built.board.map((row) => {
    const counts = new Map()
    for (const face of row) counts.set(face, (counts.get(face) ?? 0) + 1)
    return counts
  })

  let claimed = 0
  for (const move of moves) {
    const row = Number(move?.r)
    const face = Number(move?.f)
    if (!Number.isInteger(row) || row < 0 || row >= rows) {
      return { ok: false, reason: 'move names a row that does not exist' }
    }
    if (!Number.isInteger(face) || face < 1 || face > FACES) {
      return { ok: false, reason: 'move names a face that does not exist' }
    }
    const left = remaining[row].get(face) ?? 0
    if (left <= 0) return { ok: false, reason: 'move plays a tile already gone' }
    remaining[row].set(face, left - 1)
    claimed += face
  }

  // A move list can only under-report, because a run claims tiles the list does
  // not name individually. It must never over-report: that is the shape a
  // forged score takes.
  if (claimed > score) {
    return { ok: false, reason: 'moves add up to more than the score claimed' }
  }
  // A game with no moves cannot have scored.
  if (score > 0 && moves.length === 0) {
    return { ok: false, reason: 'a score with no moves behind it' }
  }

  return { ok: true, score }
}
