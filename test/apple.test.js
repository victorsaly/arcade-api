import { beforeAll, describe, expect, it } from 'vitest'
import {
  appleClientSecret,
  appleRefreshToken,
  revokeApple,
  verifyAppleIdentity
} from '../src/apple.js'

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
    expect(await check(await tokenFor(good))).toEqual({ sub: 'apple:001234.abc', aud: AUD })
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

describe('revoking an Apple sign-in', () => {
  let key
  let publicKey

  beforeAll(async () => {
    const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify'
    ])
    publicKey = ec.publicKey
    const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', ec.privateKey)).toString('base64')
    key = {
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      privateKey: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`
    }
  })

  const fromB64url = (text) => Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

  it('signs a short-lived request in the team\'s name', async () => {
    const secret = await appleClientSecret({ ...key, clientId: AUD }, NOW)
    const [h, c, s] = secret.split('.')
    expect(JSON.parse(fromB64url(h))).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
    expect(JSON.parse(fromB64url(c))).toEqual({
      iss: 'TEAM123456',
      iat: NOW,
      exp: NOW + 300,
      aud: 'https://appleid.apple.com',
      sub: AUD
    })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromB64url(s),
      new TextEncoder().encode(`${h}.${c}`)
    )
    expect(ok).toBe(true)
  })

  it('trades a sign-in code for the token it will later revoke', async () => {
    const calls = []
    const fetcher = async (url, init) => {
      calls.push({ url, body: Object.fromEntries(init.body) })
      return { ok: true, json: async () => ({ refresh_token: 'r-token' }) }
    }
    expect(await appleRefreshToken({ code: 'c0de', clientId: AUD, key, fetcher })).toBe('r-token')
    expect(calls[0].url).toBe('https://appleid.apple.com/auth/token')
    expect(calls[0].body).toMatchObject({ client_id: AUD, code: 'c0de', grant_type: 'authorization_code' })
  })

  it('returns nothing when Apple declines the code or cannot be reached', async () => {
    const declined = async () => ({ ok: false, json: async () => ({}) })
    const down = async () => {
      throw new Error('offline')
    }
    expect(await appleRefreshToken({ code: 'x', clientId: AUD, key, fetcher: declined })).toBeNull()
    expect(await appleRefreshToken({ code: 'x', clientId: AUD, key, fetcher: down })).toBeNull()
  })

  it('revokes with the stored token, and reports whether it took', async () => {
    const calls = []
    const fetcher = async (url, init) => {
      calls.push({ url, body: Object.fromEntries(init.body) })
      return { ok: true }
    }
    expect(await revokeApple({ refreshToken: 'r-token', clientId: AUD, key, fetcher })).toBe(true)
    expect(calls[0].url).toBe('https://appleid.apple.com/auth/revoke')
    expect(calls[0].body).toMatchObject({ token: 'r-token', token_type_hint: 'refresh_token' })

    const down = async () => {
      throw new Error('offline')
    }
    expect(await revokeApple({ refreshToken: 'r-token', clientId: AUD, key, fetcher: down })).toBe(false)
  })
})
