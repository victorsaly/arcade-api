/**
 * Verifying Delulu Beats submissions.
 *
 * Same philosophy as the dice replay next door: the score in a submission is
 * ignored, the challenge is rebuilt from the seed, and the score is computed
 * here from what the player actually did. For these games the "proof" is the
 * player's inputs — for Afterimage, the five colours they dialled in.
 *
 * The colour math below is copied from `app/color/page.tsx` in delulubeats and
 * must stay identical to it: both sides run the same JavaScript arithmetic on
 * the same doubles, so agreement is exact, not approximate. The end-to-end
 * fixture test drives the real game and requires this Worker to accept its
 * submission, which is what pins the two together.
 */

import { mulberry32 } from './random.js'

const SLOTS = 5

/* ---------- colour math, mirrored from the game ---------- */

const hslToRgb = (h, s, l) => {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const rgbToLab = ([r, g, b]) => {
  const lin = (v) => {
    v /= 255
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  ;[x, y, z] = [f(x), f(y), f(z)]
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const deltaE = (a, b) => {
  const la = rgbToLab(hslToRgb(a.h, a.s, a.l))
  const lb = rgbToLab(hslToRgb(b.h, b.s, b.l))
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

const scoreOf = (t, g) => Math.max(0, 10 * (1 - deltaE(t, g) / 55))

/** The five colours a seed deals, exactly as the game deals them. */
export const colorTargets = (seed) => {
  const rng = mulberry32(seed >>> 0)
  return Array.from({ length: SLOTS }, () => ({
    h: Math.floor(rng() * 360),
    s: 35 + Math.floor(rng() * 60),
    l: 25 + Math.floor(rng() * 50)
  }))
}

/* ---------- verification ---------- */

const fail = (reason) => ({ ok: false, reason })

/* ---------- Sine Language: five pitches ---------- */

const F_LO = 110
const OCTAVES = 3
const posToFreq = (p) => F_LO * Math.pow(2, (p / 1000) * OCTAVES)
const cents = (a, b) => Math.abs(1200 * Math.log2(a / b))
const pitchScore = (t, g) => Math.max(0, 10 * (1 - cents(t, g) / 300))

export const soundTargets = (seed) => {
  const rng = mulberry32(seed >>> 0)
  return Array.from({ length: SLOTS }, () => posToFreq(40 + rng() * 920))
}

/* ---------- Second Sense: five durations ---------- */

/** Difficulty changes the range here, so it changes the challenge itself. */
const TIME_RANGES = {
  easy: [1500, 4000],
  hard: [1000, 7000],
  brutal: [700, 10000]
}
const durationScore = (target, guess) =>
  10 * Math.exp((-3.5 * Math.abs(guess - target)) / target)

export const timeTargets = (seed, level) => {
  const range = TIME_RANGES[level]
  if (!range) return null
  const [min, max] = range
  const rng = mulberry32(seed >>> 0)
  return Array.from({ length: SLOTS }, () => Math.round((min + rng() * (max - min)) / 10) * 10)
}

/* ---------- what each game needs from a submission ---------- */

/**
 * Each entry rebuilds the challenge and scores the player's five answers.
 *
 * `sameChallenge` records whether difficulty changes what you face or only how
 * long you get: Afterimage and Sine Language deal the same targets at every
 * level, Second Sense does not.
 */
const GAMES = {
  color: {
    levels: ['easy', 'hard', 'brutal'],
    sameChallenge: true,
    targets: (seed) => colorTargets(seed),
    valid: (g) =>
      Number.isFinite(g?.h) && g.h >= 0 && g.h <= 360 &&
      Number.isFinite(g?.s) && g.s >= 0 && g.s <= 100 &&
      Number.isFinite(g?.l) && g.l >= 0 && g.l <= 100,
    score: scoreOf
  },
  sound: {
    levels: ['easy', 'hard', 'brutal'],
    sameChallenge: true,
    targets: (seed) => soundTargets(seed),
    // The slider spans 110–880 Hz; a guess outside it never came from the game.
    valid: (g) => Number.isFinite(g) && g >= F_LO && g <= F_LO * 2 ** OCTAVES,
    score: pitchScore
  },
  time: {
    levels: ['easy', 'hard', 'brutal'],
    sameChallenge: false,
    targets: (seed, level) => timeTargets(seed, level),
    // A held duration, in milliseconds. Nobody holds a button for a minute.
    valid: (g) => Number.isFinite(g) && g > 0 && g <= 60000,
    score: durationScore
  }
}

/**
 * Rebuild the challenge, score the player's inputs, compare with the claim.
 *
 * Scores are returned in tenths — Beats scores are one-decimal (42.1 / 50)
 * and the scores table thinks in integers, so 42.1 travels as 421.
 */
export const verifyBeats = ({ modeKey, seed, score: claimed, proof }) => {
  const split = String(modeKey).lastIndexOf('-')
  const game = split > 0 ? String(modeKey).slice(0, split) : ''
  const level = split > 0 ? String(modeKey).slice(split + 1) : ''
  const spec = GAMES[game]
  if (!spec || !spec.levels.includes(level)) return fail('unknown beats mode')
  if (!Number.isFinite(Number(seed))) return fail('no seed')

  const guesses = proof?.guesses
  if (!Array.isArray(guesses) || guesses.length !== SLOTS) {
    return fail('a run is exactly five answers')
  }
  if (!guesses.every((g) => spec.valid(g))) return fail('an answer outside the controls')

  const targets = spec.targets(Number(seed), level)
  if (!targets) return fail('cannot rebuild that challenge')

  const total = targets.reduce((sum, t, i) => sum + spec.score(t, guesses[i]), 0)
  // The same rounding the game shows the player.
  const tenths = Math.round(total * 10)

  if (claimed !== undefined && Number(claimed) !== tenths) {
    return fail(`claimed ${claimed} but played ${tenths}`)
  }

  return { ok: true, score: tenths, won: false, rolls: SLOTS }
}
