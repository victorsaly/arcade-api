/**
 * Display names.
 *
 * A Google account name is not a safe default to publish unedited: people set
 * it to whatever they like, and a public board is exactly where someone tries
 * to appear official. So the name is editable, capped, stripped of the tricks
 * that make one name imitate another, and screened.
 *
 * This is deliberately conservative rather than clever. A blocklist never wins
 * outright; it only has to make the lazy attempt not worth the effort, and the
 * board is small enough to police by hand beyond that.
 */

const MAX = 24
const MIN = 1

/** Words nobody gets to wear on a public board. */
const RESERVED = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'official',
  'staff',
  'support',
  'system',
  'root',
  'owner',
  'shutthecube',
  'delulubeats',
  'null',
  'undefined',
  'anonymous'
]

/* Kept short and obvious on purpose: a long list of slurs in the source is its
   own problem, and the real defence is that entries are few enough to read. */
const BANNED = [
  'fuck',
  'shit',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'rape',
  'nazi',
  'hitler',
  'paedo',
  'pedo'
]

/**
 * Fold the lookalikes together before screening, so `f_u_c_k` and `Nl99er`
 * cannot walk straight past a plain substring check.
 */
const canonical = (name) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/4/g, 'a')
    .replace(/[^a-z]/g, '')

export const cleanName = (raw) => {
  if (typeof raw !== 'string') return { ok: false, reason: 'A name is required.' }

  const name = raw
    // Zero-width and direction-override characters exist in a name for exactly
    // one reason, and it is never a good one.
    .replace(/[​-‏‪-‮⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (name.length < MIN) return { ok: false, reason: 'A name is required.' }
  if (name.length > MAX) return { ok: false, reason: `Names are up to ${MAX} characters.` }

  // The letter check reads the name as written, not the folded form: folding
  // turns `!` into `i` so that `sh!t` is caught, which would also let a name
  // of pure punctuation pass for a word.
  if (!/\p{L}/u.test(name)) return { ok: false, reason: 'Names need at least one letter.' }

  const folded = canonical(name)
  if (!folded) return { ok: false, reason: 'Names need at least one letter.' }
  if (RESERVED.includes(folded)) return { ok: false, reason: 'That name is reserved.' }
  if (BANNED.some((word) => folded.includes(word))) {
    return { ok: false, reason: 'Please choose a different name.' }
  }

  return { ok: true, name }
}
