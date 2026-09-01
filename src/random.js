/**
 * The seeded randomness the games use, mirrored server-side.
 *
 * This has to stay byte-for-byte equivalent to `src/services/random.js` in
 * shutTheCube: the whole point is that the server can rebuild the exact board
 * a player says they played, and a one-character drift here silently rejects
 * every honest score. The parity test in `test/parity.test.js` pins it.
 */

export const mulberry32 = (seed) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const seedFrom = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h ^ (h >>> 16)) >>> 0
}

export const dailySeed = (modeKey, stamp) => seedFrom(`shutthecube:${stamp}:${modeKey}`)

export const shuffle = (values, rng) => {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
