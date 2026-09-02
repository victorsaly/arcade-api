/**
 * Working out what a submitted game was really worth.
 *
 * A leaderboard that takes the browser's word for a number is forged within a
 * week, and a forged board is worse than none — it makes every honest entry
 * meaningless. So the score in a submission is *ignored*. The server replays
 * the game against its seed and works the score out for itself.
 *
 * The replay rests on one fact: every ranked game is dealt from a seed, and
 * the whole run of dice comes out of that seed in a fixed order. If the
 * submission records what was rolled each turn, and what happened between
 * turns, this can consume exactly the same draws in the same order and check
 * that the dice really are the dice this seed deals. Fabricating a game then
 * means fabricating a run of dice that a specific seed produces, which is the
 * problem the generator exists to make hard.
 *
 * Everything downstream follows from that: each turn's tiles must add up to a
 * roll that has been proved genuine, and the score is the sum of the tiles
 * actually shut.
 */

import { mulberry32 } from './random.js'

const ROW_TOTAL = 45
const FACES = 9
/** Fisher-Yates over nine faces draws eight times. */
const SHUFFLE_DRAWS = FACES - 1
/** Wild and locked tiles seeded onto a board that has surprises. */
const SEEDED_WILD = 2
const SEEDED_LOCKED = 2

/** Mirrors `stores/modes.js`. */
export const MODES = {
  beginner: { rows: 1, hasSurprises: false },
  medium: { rows: 9, hasSurprises: true },
  ninja: { rows: 9, hasSurprises: true }
}

export const ROWS = Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, m.rows]))

const fail = (reason) => ({ ok: false, reason })

/**
 * Replay a submitted game and return what it actually scored.
 *
 * `claimed` is only ever compared against the computed score; it is never
 * trusted, and never used in its place.
 */
export const verify = ({ modeKey, seed, score: claimed, won, turns }) => {
  const mode = MODES[modeKey]
  if (!mode) return fail('unknown mode')
  if (!Number.isFinite(Number(seed))) return fail('no seed')
  if (!Array.isArray(turns) || turns.length === 0) return fail('no game recorded')
  if (turns.length > 400) return fail('implausible number of turns')

  const { rows, hasSurprises } = mode
  const max = rows * ROW_TOTAL

  // The play stream, exactly as the game derives it.
  const rng = mulberry32((Number(seed) ^ 0x9e3779b9) >>> 0)
  const burn = (n) => {
    for (let i = 0; i < n; i += 1) rng()
  }

  // The first roll follows the opening shuffle of every row.
  burn(rows * SHUFFLE_DRAWS)

  /** How many tiles of each face have been shut. Each row holds one of each. */
  const faceUsed = new Map()
  let score = 0
  let wildsPlayed = 0
  let lockedPlayed = 0
  let wildDrops = 0

  for (let t = 0; t < turns.length; t += 1) {
    const turn = turns[t]
    if (!turn || !Array.isArray(turn.d) || !Array.isArray(turn.m)) {
      return fail('turn malformed')
    }

    // Between turns, on the boards that have them, something may happen. The
    // draw that decides it comes first, so it has to be consumed here whether
    // or not anything came of it.
    if (t > 0 && hasSurprises) {
      const happened = rng() <= 0.17
      if (happened) {
        // An event is always available — a reshuffle needs nothing of the
        // board — so a draw below the threshold always produces one.
        if (!turn.e) return fail('an event was drawn but none was recorded')
        burn(1) // which event
        if (turn.e === 'reshuffle') burn(rows * SHUFFLE_DRAWS)
        else if (turn.e === 'wildDrop') {
          burn(1)
          wildDrops += 1
        } else if (turn.e !== 'thirdDie') return fail('unknown event')
      } else if (turn.e) {
        return fail('an event was recorded that was never drawn')
      }
    } else if (turn.e) {
      return fail('an event on a board that has none')
    }

    // The dice. A wrong count or a wrong face here means the seed did not
    // produce this game.
    if (turn.d.length < 1 || turn.d.length > 3) return fail('impossible dice count')
    for (const face of turn.d) {
      if ((Math.floor(rng() * 6) + 1) !== face) return fail('dice do not match the seed')
    }

    const roll = turn.d.reduce((a, b) => a + b, 0)

    // What was played toward that roll.
    let matched = 0
    let turnScore = 0
    for (const move of turn.m) {
      const face = Number(move?.f)
      const run = Number(move?.n)
      const worth = Number(move?.w)
      const kind = move?.k ?? 'normal'

      if (!Number.isInteger(face) || face < 1 || face > FACES) return fail('impossible face')
      if (!Number.isInteger(run) || run < 1 || run > rows) return fail('impossible run length')
      if (!Number.isInteger(worth) || worth < 1 || worth > FACES) return fail('impossible worth')

      // A run only ever collapses a column of the *same* face, and only on a
      // board that has runs. A special tile is a move of its own.
      if (run > 1 && (!hasSurprises || kind !== 'normal')) return fail('run where none is possible')
      if (kind === 'normal' && worth !== face) return fail('a plain tile is worth its face')
      if (kind === 'locked' && worth !== face) return fail('a locked tile is worth its face')
      if (kind === 'wild') wildsPlayed += 1
      else if (kind === 'locked') lockedPlayed += 1
      else if (kind !== 'normal') return fail('unknown tile kind')
      if (kind !== 'normal' && !hasSurprises) return fail('a special tile on a plain board')

      // A row holds one tile of each face, so a face cannot be shut more times
      // than there are rows.
      const used = (faceUsed.get(face) ?? 0) + run
      if (used > rows) return fail('that face has run out')
      faceUsed.set(face, used)

      matched += worth
      // Every tile in a run shows the same face, and a shut tile always scores
      // its own face — a wild included.
      turnScore += run * face
    }

    if (matched > roll) return fail('played more than the roll')

    if (matched === roll) {
      // The roll was matched, so the turn banks.
      score += turnScore
    } else if (t !== turns.length - 1) {
      // Falling short only ever ends the game, so it can only be the last turn.
      return fail('an unfinished turn before the end of the game')
    }
    // A final turn that fell short scores nothing: those tiles were released.
  }

  // Specials are seeded two apiece, and only a wild drop adds another.
  if (wildsPlayed > SEEDED_WILD + wildDrops) return fail('more wild tiles than existed')
  if (lockedPlayed > SEEDED_LOCKED) return fail('more locked tiles than existed')
  if (score > max) return fail('score above the board')

  const reallyWon = score === max
  if (Boolean(won) !== reallyWon) return fail('win flag disagrees with the game')
  if (claimed !== undefined && Number(claimed) !== score) {
    return fail(`claimed ${claimed} but played ${score}`)
  }

  return { ok: true, score, won: reallyWon, rolls: turns.length }
}
