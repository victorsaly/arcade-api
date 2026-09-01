/**
 * Signing in with Google, without shipping any of Google's JavaScript.
 *
 * The usual integration drops `accounts.google.com/gsi/client` into the page.
 * These games deliberately load nothing from a CDN at runtime — the 2018 build
 * lost its styling when an unversioned CDN tag moved, and both games are
 * offline-first PWAs — so this uses the plain redirect flow instead. The
 * browser goes to Google and comes back; no third-party script is ever loaded,
 * and the game keeps working with the network off.
 *
 * The client secret lives here as a Worker secret, never in the page.
 */

const enc = new TextEncoder()

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const unb64url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export const randomId = (bytes = 16) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ])

/**
 * Our own session token: a small signed JWT naming the player and nothing
 * else. Google's tokens are exchanged once and discarded — we never store or
 * re-present them.
 */
export const mintSession = async (playerId, secret, ttlSeconds = 60 * 60 * 24 * 30) => {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    enc.encode(JSON.stringify({ sub: playerId, iat: now, exp: now + ttlSeconds }))
  )
  const body = `${header}.${payload}`
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${b64url(signature)}`
}

/** The player id inside a session token, or null if it does not hold up. */
export const readSession = async (token, secret) => {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    unb64url(signature),
    enc.encode(`${header}.${payload}`)
  )
  if (!ok) return null
  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64url(payload)))
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

/** Where we send the browser to ask Google who this is. */
export const authorizeUrl = ({ clientId, redirectUri, state }) => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Only the non-sensitive scopes: a stable id and a display name. No email,
    // so there is no mailing list to be tempted by and far less to protect.
    scope: 'openid profile',
    state,
    prompt: 'select_account',
    include_granted_scopes: 'false'
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/**
 * Trade the one-time code for the identity behind it.
 *
 * The id token comes straight from Google's token endpoint over TLS in direct
 * response to our authenticated request, so its claims can be read without a
 * separate signature check — the transport is the proof. Tokens arriving by
 * any other route would have to be verified against Google's JWKS.
 */
export const exchangeCode = async ({ code, clientId, clientSecret, redirectUri }) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })
  if (!response.ok) return null
  const tokens = await response.json()
  const idToken = tokens?.id_token
  if (typeof idToken !== 'string') return null
  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64url(idToken.split('.')[1])))
    if (claims?.iss !== 'https://accounts.google.com' && claims?.iss !== 'accounts.google.com') {
      return null
    }
    if (claims?.aud !== clientId) return null
    if (typeof claims?.sub !== 'string') return null
    return { sub: claims.sub, name: claims.given_name || claims.name || 'Player' }
  } catch {
    return null
  }
}
