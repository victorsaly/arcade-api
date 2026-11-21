/**
 * Sign in with Apple, for the installed apps.
 *
 * The app asks iOS who this is and receives an identity token: a JWT signed by
 * Apple. It arrives here from the device rather than straight from Apple, so
 * unlike the Google exchange in auth.js the transport proves nothing and the
 * signature has to be checked against Apple's published keys.
 *
 * What is kept is what Google's sign-in keeps: an opaque subject id and a
 * display name. Apple's subject is stored with an `apple:` prefix so that it
 * can never collide with a Google one.
 */

const KEYS_URL = 'https://appleid.apple.com/auth/keys'
const ISSUER = 'https://appleid.apple.com'

const unb64url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const decode = (part) => JSON.parse(new TextDecoder().decode(unb64url(part)))

/* Apple rotates its keys rarely; an hour's memory spares a fetch per sign-in. */
let cache = { at: 0, keys: [] }
const fetchAppleKeys = async () => {
  if (Date.now() - cache.at < 3_600_000 && cache.keys.length) return cache.keys
  const response = await fetch(KEYS_URL)
  if (!response.ok) return cache.keys
  const body = await response.json()
  cache = { at: Date.now(), keys: Array.isArray(body?.keys) ? body.keys : [] }
  return cache.keys
}

/**
 * The identity behind an Apple identity token, or null if it does not hold up.
 *
 * `audiences` is the list of app bundle ids this API accepts tokens for: a
 * token Apple issued to some other app is genuine, and still not ours.
 */
export const verifyAppleIdentity = async (
  token,
  { audiences = [], fetchKeys = fetchAppleKeys, now = () => Math.floor(Date.now() / 1000) } = {}
) => {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = decode(parts[0])
    const claims = decode(parts[1])
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

    const jwk = (await fetchKeys()).find((k) => k.kid === header.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(parts[2]), signed)
    if (!ok) return null

    if (claims.iss !== ISSUER) return null
    if (!audiences.includes(claims.aud)) return null
    if (typeof claims.exp !== 'number' || claims.exp < now()) return null
    if (typeof claims.sub !== 'string' || !claims.sub) return null
    return { sub: `apple:${claims.sub}`, aud: claims.aud }
  } catch {
    return null
  }
}

// ------------------------------------------------------------ revocation

const TOKEN_URL = 'https://appleid.apple.com/auth/token'
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke'

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const enc = new TextEncoder()

/** The key Apple issued, from the text of its .p8 file. */
const importAppleKey = (pem) => {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/**
 * The "client secret" Apple asks for: not a stored secret but a short-lived
 * JWT, signed with the team's key, saying which app is asking.
 */
export const appleClientSecret = async (
  { teamId, keyId, privateKey, clientId },
  now = Math.floor(Date.now() / 1000)
) => {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: keyId })))
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        iss: teamId,
        iat: now,
        exp: now + 300,
        aud: 'https://appleid.apple.com',
        sub: clientId
      })
    )
  )
  const signed = `${header}.${claims}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importAppleKey(privateKey),
    enc.encode(signed)
  )
  return `${signed}.${b64url(signature)}`
}

/** Whether this deployment holds what revocation needs. */
export const appleKeyFrom = (env) =>
  env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
    ? { teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY }
    : null

/**
 * Trade the one-time authorization code from a sign-in for a refresh token.
 * Kept only so the account can later be revoked; null if Apple declines.
 */
export const appleRefreshToken = async ({ code, clientId, key, fetcher = fetch }) => {
  try {
    const response = await fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: await appleClientSecret({ ...key, clientId }),
        code,
        grant_type: 'authorization_code'
      })
    })
    if (!response.ok) return null
    const tokens = await response.json()
    return typeof tokens?.refresh_token === 'string' ? tokens.refresh_token : null
  } catch {
    return null
  }
}

/** Tell Apple this app no longer has access to the account. True if it took. */
export const revokeApple = async ({ refreshToken, clientId, key, fetcher = fetch }) => {
  try {
    const response = await fetcher(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: await appleClientSecret({ ...key, clientId }),
        token: refreshToken,
        token_type_hint: 'refresh_token'
      })
    })
    return response.ok
  } catch {
    return false
  }
}
