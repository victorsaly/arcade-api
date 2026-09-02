import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { verify } from '../src/verify.js'

/**
 * The replay must agree with the game, on games the game actually played.
 *
 * `fixtures.json` is written by shutTheCube's own suite from real games driven
 * through the real engine. If the two implementations ever drift, this fails —
 * which is the whole point, because the alternative is silently rejecting
 * every honest score.
 */
const games = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))

describe('replaying real games', () => {
  it('has fixtures to work with', () => {
    expect(games.length).toBeGreaterThan(10)
  })

  for (const [i, g] of games.entries()) {
    it(`agrees with the game on #${i} (${g.mode}, ${g.turns.length} turns)`, () => {
      const result = verify({
        modeKey: g.mode,
        seed: g.seed,
        score: g.score,
        won: g.won,
        turns: g.turns
      })
      expect(result.reason ?? 'ok').toBe('ok')
      expect(result.score).toBe(g.score)
      expect(result.won).toBe(g.won)
      expect(result.rolls).toBe(g.rolls)
    })
  }
})

describe('refusing a forged game', () => {
  const real = games.find((g) => g.mode === 'medium')

  const tampered = (mutate) => {
    const copy = structuredClone(real)
    mutate(copy)
    return verify({
      modeKey: copy.mode,
      seed: copy.seed,
      score: copy.score,
      won: copy.won,
      turns: copy.turns
    })
  }

  it('rejects a score simply claimed to be higher', () => {
    expect(tampered((g) => (g.score = 405)).ok).toBe(false)
  })

  it('rejects claiming the box was shut', () => {
    expect(tampered((g) => { g.score = 405; g.won = true }).ok).toBe(false)
  })

  it('rejects dice edited to something friendlier', () => {
    expect(tampered((g) => (g.turns[0].d = [6, 6])).ok).toBe(false)
  })

  it('rejects an extra tile smuggled into a turn', () => {
    expect(
      tampered((g) => g.turns[0].m.push({ f: 9, n: 1, w: 9, k: 'normal' })).ok
    ).toBe(false)
  })

  it('rejects a run longer than the board is tall', () => {
    expect(tampered((g) => (g.turns[0].m[0].n = 99)).ok).toBe(false)
  })

  it('rejects an invented event that changes the dice', () => {
    expect(tampered((g) => (g.turns[1].e = 'reshuffle')).ok).toBe(false)
  })

  it('rejects a wild tile that was never on the board', () => {
    expect(
      tampered((g) => {
        for (const t of g.turns) for (const m of t.m) { m.k = 'wild'; m.w = 9 }
      }).ok
    ).toBe(false)
  })

  it('rejects a game replayed under a different seed', () => {
    expect(tampered((g) => (g.seed = (g.seed + 1) >>> 0)).ok).toBe(false)
  })

  it('rejects a turn removed from the middle', () => {
    expect(tampered((g) => g.turns.splice(1, 1)).ok).toBe(false)
  })

  it('rejects an empty game claiming a score', () => {
    expect(verify({ modeKey: 'medium', seed: 1, score: 100, won: false, turns: [] }).ok).toBe(false)
  })
})

describe('modes', () => {
  it('refuses specials on a board that has none', () => {
    const beginner = games.find((g) => g.mode === 'beginner')
    const copy = structuredClone(beginner)
    copy.turns[0].m[0].k = 'wild'
    expect(verify({ modeKey: 'beginner', seed: copy.seed, won: copy.won, turns: copy.turns }).ok).toBe(false)
  })

  it('refuses an event on a board that has none', () => {
    const beginner = structuredClone(games.find((g) => g.mode === 'beginner'))
    if (beginner.turns.length > 1) {
      beginner.turns[1].e = 'thirdDie'
      expect(verify({ modeKey: 'beginner', seed: beginner.seed, won: beginner.won, turns: beginner.turns }).ok).toBe(false)
    }
  })

  it('refuses an unknown mode', () => {
    expect(verify({ modeKey: 'cheating', seed: 1, turns: [{ d: [1], m: [] }] }).ok).toBe(false)
  })
})
