/**
 * Where a sign-in is allowed to send the player back to.
 *
 * The one-time code that becomes a session rides on this redirect, so the
 * check decides who can receive it. It must match an origin exactly: a prefix
 * test would let `https://shutthecube.com.evil.example` pass for
 * `https://shutthecube.com`, and hand that site a working sign-in.
 *
 * Two kinds of destination:
 *
 *   a website   http or https, whose origin is on the allowed list;
 *   an app      a custom-scheme address on its own list, matched whole
 *               (`com.victorsaly.shutthecube://auth`). The system browser
 *               hands that back to the installed app.
 */
export const listOf = (text) =>
  (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export const allowedRedirect = (back, { origins = [], appRedirects = [] } = {}) => {
  if (typeof back !== 'string' || back.length === 0) return false
  if (appRedirects.includes(back)) return true
  let url
  try {
    url = new URL(back)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  // No credentials smuggled into the address, which some parsers read as the host.
  if (url.username || url.password) return false
  return origins.includes(url.origin)
}

/** Append the one-time code, whatever the destination already carries. */
export const withCode = (back, code) => `${back}${back.includes('?') ? '&' : '?'}auth=${code}`
