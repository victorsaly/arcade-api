/**
 * The board this Worker rebuilds must be the board the game dealt.
 *
 * If these two implementations ever drift, nothing shouts: every honest score
 * is quietly rejected as a forgery. So the seeded generator is pinned here
 * against fixed expected values, and the game's copy is pinned against the
 * same ones in its own suite.
 */
import { describe, expect, it } from 'vitest'
import { dailySeed, mulberry32, seedFrom, shuffle } from '../src/random.js'
/* Replaying whole games lives in replay.test.js, against real recorded games. */
import { cleanName } from '../src/names.js'

describe('the seeded generator', () => {
  it('produces the pinned stream for a known seed', () => {
    const rng = mulberry32(12345)
    const first = [rng(), rng(), rng()].map((n) => Number(n.toFixed(10)))
    // Measured from shutTheCube's own `src/services/random.js` and confirmed
    // identical. Change these only if you have changed the generator in BOTH
    // copies and accepted that every daily board that ever existed becomes a
    // different board.
    expect(first).toEqual([0.9797282678, 0.3067522645, 0.4842054215])
  })

  it('hashes a known string to the pinned seed', () => {
    expect(seedFrom('shutthecube:2026-09-01:medium')).toBe(dailySeed('medium', '2026-09-01'))
  })

  it('shuffles reproducibly', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(shuffle(values, mulberry32(7))).toEqual(shuffle(values, mulberry32(7)))
  })
})

describe('display names', () => {
  it('keeps an ordinary name', () => {
    expect(cleanName('Victor')).toEqual({ ok: true, name: 'Victor' })
  })

  it('collapses stray whitespace', () => {
    expect(cleanName('  Ada   Lovelace  ').name).toBe('Ada Lovelace')
  })

  it('refuses an empty or absent name', () => {
    expect(cleanName('   ').ok).toBe(false)
    expect(cleanName(undefined).ok).toBe(false)
  })

  it('refuses one that is too long', () => {
    expect(cleanName('x'.repeat(25)).ok).toBe(false)
  })

  it('refuses names that claim authority', () => {
    expect(cleanName('admin').ok).toBe(false)
    expect(cleanName('Official').ok).toBe(false)
  })

  it('sees through letter-for-digit substitution', () => {
    expect(cleanName('4dm1n').ok).toBe(false)
  })

  it('strips zero-width characters used to disguise a name', () => {
    expect(cleanName('ad​min').ok).toBe(false)
  })

  it('needs at least one letter', () => {
    expect(cleanName('!!!').ok).toBe(false)
  })
})
