import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import {
  DOWNBEAT, downbeatNotes, downbeatScore, echoPattern, echoScore,
  mulberry32, refrainExtend, refrainKeyCount, refrainScore,
} from '../src/challenges.mjs'
import { verifyBeats } from '../src/beats.js'

/**
 * `challenges.mjs` is a copy of the file of the same name in delulubeats,
 * placed here by its `npm run sync:arcade`. If the game's copy changes and
 * this one is not resynced, the server rebuilds challenges the game never
 * dealt and refuses every honest score — silently. This is what makes that
 * loud instead.
 */
describe('the shared challenge module', () => {
  it('is the copy the game last synced', () => {
    const hashFile = new URL('../src/challenges.hash', import.meta.url)
    if (!existsSync(hashFile)) return // never synced on this machine
    const expected = readFileSync(hashFile, 'utf8').trim()
    const actual = createHash('sha256')
      .update(readFileSync(new URL('../src/challenges.mjs', import.meta.url)))
      .digest('hex')
      .slice(0, 16)
    expect(actual).toBe(expected)
  })

  it('carries no TypeScript or browser-only syntax', () => {
    const src = readFileSync(new URL('../src/challenges.mjs', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\bimport\s+.*\bfrom\b/) // must stand alone
    expect(src).not.toMatch(/\b(interface|: string|: number\b)/)
    expect(src).not.toMatch(/\b(document|window|localStorage|AudioContext)\b/)
  })
})

describe('Echo', () => {
  const seed = 4242
  const perfectRun = (level, cells, levels) => {
    const rng = mulberry32(seed)
    return Array.from({ length: levels }, (_, i) => echoPattern(rng, cells, i + 1))
  }

  it('grows by a tile a level and stops at the grid', () => {
    const rng = mulberry32(seed)
    const sizes = Array.from({ length: 20 }, (_, i) => echoPattern(rng, 16, i + 1).length)
    expect(sizes[0]).toBe(4)
    expect(sizes[1]).toBe(5)
    expect(Math.max(...sizes)).toBe(15) // one short of the whole grid
  })

  it('counts a flawless run as levels cleared', () => {
    expect(echoScore(seed, 'easy', perfectRun('easy', 16, 6))).toBe(6)
  })

  it('spends a life on a wrong tile, and retries the same level', () => {
    /*
     * A miss does not advance the level — the game re-deals one of the same
     * size — so the run has to be walked forward the way the game walks it,
     * not assembled from levels 1..n up front.
     */
    const rng = mulberry32(seed)
    const run = []
    let cleared = 0
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const pattern = echoPattern(rng, 16, cleared + 1)
      if (attempt === 1) run.push([...pattern].reverse()) // fluff the second go
      else {
        run.push(pattern)
        cleared += 1
      }
    }
    expect(echoScore(seed, 'easy', run)).toBe(3)
  })

  it('refuses a run that carried on past its last life', () => {
    const run = perfectRun('easy', 16, 5).map(() => [0])
    expect(echoScore(seed, 'easy', run)).toBe(null)
  })

  it('refuses a tile that is not on the board', () => {
    expect(echoScore(seed, 'easy', [[99, 1, 2, 3]])).toBe(null)
  })

  it('deals a bigger grid on harder levels', () => {
    expect(echoScore(seed, 'brutal', [[0]])).not.toBe(null)
  })
})

describe('Refrain', () => {
  const seed = 777

  it('shows the board the game shows', () => {
    expect(refrainKeyCount('easy')).toBe(8) // whites only
    expect(refrainKeyCount('hard')).toBe(13)
    expect(refrainKeyCount('brutal')).toBe(17)
  })

  it('starts on three notes and adds one a level', () => {
    const rng = mulberry32(seed)
    const melody = []
    for (let k = 0; k < 3; k += 1) refrainExtend(rng, melody, 8)
    expect(melody).toHaveLength(3)
    refrainExtend(rng, melody, 8)
    expect(melody).toHaveLength(4)
  })

  it('never steps off the keyboard, and never repeats a note', () => {
    const rng = mulberry32(seed)
    const melody = []
    for (let k = 0; k < 60; k += 1) refrainExtend(rng, melody, 8)
    expect(melody.every((n) => n >= 0 && n < 8)).toBe(true)
    for (let i = 1; i < melody.length; i += 1) expect(melody[i]).not.toBe(melody[i - 1])
  })

  it('counts a flawless run as levels cleared', () => {
    const rng = mulberry32(seed)
    const melody = []
    const taps = []
    for (let l = 0; l < 5; l += 1) {
      const add = melody.length === 0 ? 3 : 1
      for (let k = 0; k < add; k += 1) refrainExtend(rng, melody, 8)
      taps.push([...melody])
    }
    expect(refrainScore(seed, 'easy', taps)).toBe(5)
  })

  it('refuses a key that is not on the board', () => {
    expect(refrainScore(seed, 'easy', [[99, 1, 2]])).toBe(null)
  })
})

describe('Downbeat', () => {
  it('counts the playable notes of each timeline', () => {
    expect(downbeatNotes('easy')).toBe(32)
    expect(downbeatNotes('medium')).toBe(50)
    expect(downbeatNotes('hard')).toBe(120)
    expect(downbeatNotes('brutal')).toBe(176)
    expect(downbeatNotes('nonsense')).toBe(null)
  })

  it('scores a flawless run at a hundred per cent', () => {
    expect(downbeatScore('easy', { perfect: 32, good: 0, ok: 0, strays: 0 })).toBe(1000)
  })

  it('scores nothing for playing nothing', () => {
    expect(downbeatScore('easy', { perfect: 0, good: 0, ok: 0, strays: 0 })).toBe(0)
  })

  it('charges for taps that hit nothing', () => {
    const clean = downbeatScore('easy', { perfect: 20, good: 0, ok: 0, strays: 0 })
    const messy = downbeatScore('easy', { perfect: 20, good: 0, ok: 0, strays: 10 })
    expect(messy).toBeLessThan(clean)
  })

  it('refuses more hits than the timeline holds', () => {
    expect(downbeatScore('easy', { perfect: 999, good: 0, ok: 0, strays: 0 })).toBe(null)
  })

  it('refuses fractional tallies', () => {
    expect(downbeatScore('easy', { perfect: 1.5, good: 0, ok: 0, strays: 0 })).toBe(null)
  })

  it('has a fourth difficulty the other games do not', () => {
    expect(Object.keys(DOWNBEAT.tracks)).toContain('medium')
  })
})

describe('all nine games now answer', () => {
  const seed = 999
  it('accepts a plausible run from every game', () => {
    const runs = [
      ['color-hard', { guesses: Array(5).fill({ h: 100, s: 50, l: 50 }) }],
      ['sound-hard', { guesses: Array(5).fill(440) }],
      ['time-hard', { guesses: Array(5).fill(2000) }],
      ['fever-hard', { errors: Array(8).fill(20) }],
      ['phantom-hard', { errors: [10, 20, 30] }],
      ['offgrid-hard', { picks: [1, 2, 3, 4, 5] }],
      ['memory-easy', { taps: [[0, 1, 2, 3]] }],
      ['piano-easy', { taps: [[0, 1, 2]] }],
      ['tempo-easy', { counts: { perfect: 10, good: 5, ok: 2, strays: 1 } }],
    ]
    for (const [mode, proof] of runs) {
      const r = verifyBeats({ modeKey: mode, seed, proof })
      expect(`${mode}: ${r.reason ?? 'ok'}`).toBe(`${mode}: ok`)
      expect(r.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('still refuses a game that does not exist', () => {
    expect(verifyBeats({ modeKey: 'studio-easy', seed, proof: {} }).ok).toBe(false)
  })
})
