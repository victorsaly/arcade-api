import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { colorTargets, timeTargets, verifyBeats } from '../src/beats.js'

/**
 * The Worker's colour math must agree with the game's, exactly.
 *
 * `beats-fixtures.json` is dealt and scored with delulubeats' own arithmetic,
 * so if this Worker's copy drifts by a single operation the totals part
 * company and every honest score starts being refused.
 */
const runs = JSON.parse(readFileSync(new URL('./beats-fixtures.json', import.meta.url)))

describe('rebuilding an Afterimage challenge', () => {
  it('deals the same five colours the game dealt', () => {
    for (const run of runs) {
      expect(colorTargets(run.seed)).toEqual(run.targets)
    }
  })

  it('deals a different challenge each day', () => {
    const seeds = new Set(runs.map((r) => r.seed))
    expect(seeds.size).toBeGreaterThan(1)
  })
})

describe('scoring a run', () => {
  for (const run of runs) {
    it(`agrees with the game on ${run.stamp} (${run.label}, ${run.tenths})`, () => {
      const result = verifyBeats({
        modeKey: 'color-hard',
        seed: run.seed,
        score: run.tenths,
        proof: { guesses: run.guesses }
      })
      expect(result.reason ?? 'ok').toBe('ok')
      expect(result.score).toBe(run.tenths)
    })
  }

  it('scores every difficulty from the same challenge', () => {
    const run = runs[0]
    for (const mode of ['color-easy', 'color-hard', 'color-brutal']) {
      const r = verifyBeats({ modeKey: mode, seed: run.seed, proof: { guesses: run.guesses } })
      expect(r.score).toBe(run.tenths)
    }
  })
})

describe('refusing a forged run', () => {
  const run = runs[0]
  const attempt = (patch) =>
    verifyBeats({
      modeKey: 'color-hard',
      seed: run.seed,
      score: run.tenths,
      proof: { guesses: run.guesses },
      ...patch
    })

  it('rejects a score simply claimed to be higher', () => {
    expect(attempt({ score: 500 }).ok).toBe(false)
  })

  it('rejects the perfect score', () => {
    expect(attempt({ score: 500, proof: { guesses: run.guesses } }).ok).toBe(false)
  })

  it('accepts a genuinely perfect run', () => {
    // Answering with the targets themselves is legitimate, if improbable.
    const perfect = verifyBeats({
      modeKey: 'color-hard',
      seed: run.seed,
      proof: { guesses: colorTargets(run.seed) }
    })
    expect(perfect.ok).toBe(true)
    expect(perfect.score).toBe(500)
  })

  it('rejects a run under a different seed', () => {
    expect(attempt({ seed: (run.seed + 1) >>> 0 }).ok).toBe(false)
  })

  it('rejects the wrong number of colours', () => {
    expect(attempt({ proof: { guesses: run.guesses.slice(0, 3) } }).ok).toBe(false)
  })

  it('rejects values outside the sliders', () => {
    const bad = structuredClone(run.guesses)
    bad[0].h = 9999
    expect(attempt({ proof: { guesses: bad } }).ok).toBe(false)
  })

  it('rejects a missing proof', () => {
    expect(attempt({ proof: null }).ok).toBe(false)
  })

  it('rejects a game with no checker', () => {
    expect(verifyBeats({ modeKey: 'tempo-hard', seed: 1, proof: {} }).ok).toBe(false)
  })
})

/**
 * Sine Language and Second Sense, against fixtures dealt and scored with the
 * games' own arithmetic.
 *
 * Second Sense is the one that matters most here: its difficulty changes the
 * range the durations are drawn from, so it changes the challenge itself
 * rather than only the time you get. Getting that wrong would reject every
 * honest score on two of its three boards.
 */
const more = JSON.parse(readFileSync(new URL('./beats-more.json', import.meta.url)))

describe('the other ranked games', () => {
  for (const run of more) {
    it(`agrees on ${run.game}-${run.level} ${run.st} (${run.label}, ${run.tenths})`, () => {
      const r = verifyBeats({
        modeKey: `${run.game}-${run.level}`,
        seed: run.seed,
        score: run.tenths,
        proof: { guesses: run.guesses }
      })
      expect(r.reason ?? 'ok').toBe('ok')
      expect(r.score).toBe(run.tenths)
    })
  }

  it('rebuilds Second Sense differently at each difficulty', () => {
    // Not via the score: a wildly wrong guess scores near zero at every range
    // and rounds to the same number. The targets themselves are the claim.
    const seed = more.find((r) => r.game === 'time').seed
    const easy = timeTargets(seed, 'easy')
    const brutal = timeTargets(seed, 'brutal')
    expect(easy).not.toEqual(brutal)
    // Easy stays inside 1500-4000ms; brutal reaches further in both directions.
    expect(Math.min(...easy)).toBeGreaterThanOrEqual(1500)
    expect(Math.max(...easy)).toBeLessThanOrEqual(4000)
    expect(Math.max(...brutal)).toBeGreaterThan(4000)
  })

  it('refuses a difficulty it cannot rebuild', () => {
    expect(timeTargets(1, 'impossible')).toBe(null)
  })

  it('rejects a pitch outside the slider', () => {
    const run = more.find((r) => r.game === 'sound')
    const bad = [...run.guesses]
    bad[0] = 20000
    expect(verifyBeats({ modeKey: 'sound-hard', seed: run.seed, proof: { guesses: bad } }).ok).toBe(false)
  })

  it('rejects an inflated pitch score', () => {
    const run = more.find((r) => r.game === 'sound')
    expect(
      verifyBeats({ modeKey: 'sound-hard', seed: run.seed, score: 500, proof: { guesses: run.guesses } }).ok
    ).toBe(false)
  })

  it('still refuses a game with no checker', () => {
    expect(verifyBeats({ modeKey: 'tempo-hard', seed: 1, proof: { guesses: [1,2,3,4,5] } }).ok).toBe(false)
    expect(verifyBeats({ modeKey: 'offgrid-easy', seed: 1, proof: { guesses: [1,2,3,4,5] } }).ok).toBe(false)
  })
})
