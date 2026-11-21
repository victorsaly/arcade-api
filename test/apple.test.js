import { beforeAll, describe, expect, it } from 'vitest'
import { verifyAppleIdentity } from '../src/apple.js'

/**
 * Apple's side is played by a key pair made here: the public half is served
 * as the key set, the private half signs tokens the way Apple would.
 */
const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const part = (object) => b64url(new TextEncoder().encode(JSON.stringify(object)))

const AUD = 'com.victorsaly.shutthecube'
const NOW = 1_800_000_000
let pair
let keys

const tokenFor = async (claims, { kid = 'k1', alg = 'RS256', key = pair.privateKey } = {}) => {
  const body = `${part({ alg, kid })}.${part(claims)}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body))
  return `${body}.${b64url(new Uint8Array(signature))}`
}
const good = { iss: 'https://appleid.apple.com', aud: AUD, exp: NOW + 600, sub: '001234.abc' }
const check = (token) =>
  verifyAppleIdentity(token, { audiences: [AUD], fetchKeys: async () => keys, now: () => NOW })

beforeAll(async () => {
  const make = () =>
    crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    )
  pair = await make()
  keys = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' }]
})

describe('an Apple identity token', () => {
  it('is accepted when Apple signed it for this app', async () => {
    expect(await check(await tokenFor(good))).toEqual({ sub: 'apple:001234.abc' })
  })

  it('is refused when it was issued to another app', async () => {
    expect(await check(await tokenFor({ ...good, aud: 'com.someone.else' }))).toBeNull()
  })

  it('is refused once it has expired', async () => {
    expect(await check(await tokenFor({ ...good, exp: NOW - 1 }))).toBeNull()
  })

  it('is refused from any other issuer', async () => {
    expect(await check(await tokenFor({ ...good, iss: 'https://evil.example' }))).toBeNull()
  })

  it('is refused when signed by a key Apple does not publish', async () => {
    const stranger = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    )
    expect(await check(await tokenFor(good, { key: stranger.privateKey }))).toBeNull()
    expect(await check(await tokenFor(good, { kid: 'unknown' }))).toBeNull()
  })

  it('is refused when its claims were changed after signing', async () => {
    const token = await tokenFor(good)
    const [h, , s] = token.split('.')
    expect(await check(`${h}.${part({ ...good, sub: 'someone-else' })}.${s}`)).toBeNull()
  })

  it('is refused when it claims to need no signature', async () => {
    const unsigned = `${part({ alg: 'none', kid: 'k1' })}.${part(good)}.`
    expect(await check(unsigned)).toBeNull()
  })

  it('is refused when it is not a token at all', async () => {
    expect(await check('nope')).toBeNull()
    expect(await check(undefined)).toBeNull()
  })
})
