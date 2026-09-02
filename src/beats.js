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

/** Modes this can currently check. Difficulty changes the reveal time, never
 *  the challenge, so every difficulty shares the generator. */
const COLOR_MODES = new Set(['color-easy', 'color-hard', 'color-brutal'])

/**
 * Rebuild the challenge, score the player's inputs, compare with the claim.
 *
 * Scores are returned in tenths — Beats scores are one-decimal (42.1 / 50)
 * and the scores table thinks in integers, so 42.1 travels as 421.
 */
export const verifyBeats = ({ modeKey, seed, score: claimed, proof }) => {
  if (!COLOR_MODES.has(modeKey)) return fail('unknown beats mode')
  if (!Number.isFinite(Number(seed))) return fail('no seed')

  const guesses = proof?.guesses
  if (!Array.isArray(guesses) || guesses.length !== SLOTS) {
    return fail('a run is exactly five colours')
  }
  for (const g of guesses) {
    const { h, s, l } = g ?? {}
    // The sliders' own ranges; anything outside them never came from the game.
    if (!Number.isFinite(h) || h < 0 || h > 360) return fail('impossible hue')
    if (!Number.isFinite(s) || s < 0 || s > 100) return fail('impossible saturation')
    if (!Number.isFinite(l) || l < 0 || l > 100) return fail('impossible lightness')
  }

  const targets = colorTargets(Number(seed))
  const total = targets.reduce((sum, t, i) => sum + scoreOf(t, guesses[i]), 0)
  // The same rounding the game shows the player.
  const tenths = Math.round(total * 10)

  if (claimed !== undefined && Number(claimed) !== tenths) {
    return fail(`claimed ${claimed} but played ${tenths}`)
  }

  return { ok: true, score: tenths, won: false, rolls: SLOTS }
}
