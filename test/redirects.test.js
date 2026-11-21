import { describe, expect, it } from 'vitest'
import { allowedRedirect, withCode } from '../src/redirects.js'

const rules = {
  origins: ['https://shutthecube.com', 'http://localhost:5173'],
  appRedirects: ['com.victorsaly.shutthecube://auth']
}

describe('where a sign-in may return to', () => {
  it('accepts a page on an allowed site', () => {
    expect(allowedRedirect('https://shutthecube.com/', rules)).toBe(true)
    expect(allowedRedirect('https://shutthecube.com/play', rules)).toBe(true)
    expect(allowedRedirect('http://localhost:5173/', rules)).toBe(true)
  })

  it('refuses a site that merely begins with an allowed one', () => {
    // The one-time code rides on this redirect: a prefix match here would
    // hand a working sign-in to whoever registered the longer name.
    expect(allowedRedirect('https://shutthecube.com.evil.example/', rules)).toBe(false)
    expect(allowedRedirect('https://shutthecube.comx/', rules)).toBe(false)
    expect(allowedRedirect('https://shutthecube.com@evil.example/', rules)).toBe(false)
  })

  it('refuses another port, scheme or site', () => {
    expect(allowedRedirect('http://shutthecube.com/', rules)).toBe(false)
    expect(allowedRedirect('http://localhost:9999/', rules)).toBe(false)
    expect(allowedRedirect('https://example.com/', rules)).toBe(false)
    expect(allowedRedirect('javascript:alert(1)', rules)).toBe(false)
  })

  it('accepts an app only at its exact address', () => {
    expect(allowedRedirect('com.victorsaly.shutthecube://auth', rules)).toBe(true)
    expect(allowedRedirect('com.victorsaly.shutthecube://auth/extra', rules)).toBe(false)
    expect(allowedRedirect('com.someone.else://auth', rules)).toBe(false)
  })

  it('refuses nonsense', () => {
    expect(allowedRedirect('', rules)).toBe(false)
    expect(allowedRedirect(null, rules)).toBe(false)
    expect(allowedRedirect('not a url', rules)).toBe(false)
  })

  it('adds the code without breaking an address that already has a query', () => {
    expect(withCode('https://shutthecube.com/', 'abc')).toBe('https://shutthecube.com/?auth=abc')
    expect(withCode('https://shutthecube.com/?mode=medium', 'abc')).toBe(
      'https://shutthecube.com/?mode=medium&auth=abc'
    )
    expect(withCode('com.victorsaly.shutthecube://auth', 'abc')).toBe(
      'com.victorsaly.shutthecube://auth?auth=abc'
    )
  })
})
