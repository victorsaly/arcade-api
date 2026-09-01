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
import { boardFor, verify } from '../src/verify.js'
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

describe('rebuilding a board', () => {
  it('deals nine rows of nine distinct faces for a nine-row mode', () => {
    const { rows, board } = boardFor('medium', dailySeed('medium', '2026-09-01'))
    expect(rows).toBe(9)
    expect(board).toHaveLength(9)
    for (const row of board) {
      expect([...row].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })

  it('deals one row for beginner', () => {
    expect(boardFor('beginner', 1).board).toHaveLength(1)
  })

  it('refuses a mode it does not know', () => {
    expect(boardFor('cheating', 1)).toBe(null)
  })
})

describe('verifying a submission', () => {
  const seed = dailySeed('medium', '2026-09-01')
  const base = { modeKey: 'medium', seed, rolls: 20, won: false, moves: [] }

  it('accepts a plain honest-looking game', () => {
    const { board } = boardFor('medium', seed)
    const moves = board[0].slice(0, 3).map((f) => ({ r: 0, f }))
    const score = moves.reduce((n, m) => n + m.f, 0)
    expect(verify({ ...base, score, moves }).ok).toBe(true)
  })

  it('rejects a score above what the board holds', () => {
    expect(verify({ ...base, score: 406 }).ok).toBe(false)
  })

  it('rejects a win flag that the score does not support', () => {
    expect(verify({ ...base, score: 100, won: true, moves: [{ r: 0, f: 1 }] }).ok).toBe(false)
  })

  it('rejects moves adding up to more than the score claimed', () => {
    const { board } = boardFor('medium', seed)
    const moves = board[0].map((f) => ({ r: 0, f }))
    expect(verify({ ...base, score: 1, moves }).ok).toBe(false)
  })

  it('rejects a score with no moves behind it', () => {
    expect(verify({ ...base, score: 40, moves: [] }).ok).toBe(false)
  })

  it('rejects a tile played twice that only exists once', () => {
    const face = boardFor('medium', seed).board[0][0]
    const moves = [
      { r: 0, f: face },
      { r: 0, f: face }
    ]
    expect(verify({ ...base, score: face * 2, moves }).ok).toBe(false)
  })

  it('rejects a row that does not exist', () => {
    expect(verify({ ...base, score: 1, moves: [{ r: 99, f: 1 }] }).ok).toBe(false)
  })

  it('rejects a face that does not exist', () => {
    expect(verify({ ...base, score: 1, moves: [{ r: 0, f: 42 }] }).ok).toBe(false)
  })

  it('rejects an absurd roll count', () => {
    expect(verify({ ...base, score: 0, rolls: 99999 }).ok).toBe(false)
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
