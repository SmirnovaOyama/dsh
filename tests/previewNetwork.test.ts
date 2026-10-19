import { describe, expect, it } from 'vitest'
import { NOWHERE, OPEN_HOSTS, PreviewNetwork, cleanRoute, pacScript } from '../src/main/previewNetwork'

// Runs a PAC script the way Chromium does, with the one helper it uses.
function route(script: string, url: string) {
  const host = new URL(url).hostname
  const shExpMatch = (text: string, pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(text)
  return new Function('shExpMatch', `${script}\nreturn FindProxyForURL`)(shExpMatch)(url, host) as string
}

describe('pacScript', () => {
  const routes = { 'esm.sh': 'PROXY corp:8080', 'redirector.gvt1.com': 'DIRECT' }

  it('sends open hosts the way the system does and every other host nowhere', () => {
    const script = pacScript(routes, false)
    expect(route(script, 'https://esm.sh/react')).toBe('PROXY corp:8080')
    expect(route(script, 'https://ESM.sh/react')).toBe('PROXY corp:8080')
    expect(route(script, 'https://evil.example/')).toBe(NOWHERE)
    expect(route(script, 'https://esm.sh.evil.example/')).toBe(NOWHERE)
    expect(route(script, 'https://r1---sn-x.gvt1.com/dict')).toBe('DIRECT')
  })

  it('lets the loopback address through only while developing', () => {
    expect(route(pacScript(routes, false), 'http://localhost:5173/')).toBe(NOWHERE)
    expect(route(pacScript(routes, true), 'http://localhost:5173/')).toBe('DIRECT')
    expect(route(pacScript(routes, true), 'http://127.0.0.1:5173/')).toBe('DIRECT')
  })

  it('does not trust a host name that looks like an object key', () => {
    expect(route(pacScript(routes, false), 'https://constructor/')).toBe(NOWHERE)
    expect(route(pacScript(routes, false), 'https://__proto__/')).toBe(NOWHERE)
  })
})

describe('cleanRoute', () => {
  it('keeps proper PAC results', () => {
    expect(cleanRoute('DIRECT')).toBe('DIRECT')
    expect(cleanRoute('PROXY corp:8080;DIRECT')).toBe('PROXY corp:8080; DIRECT')
    expect(cleanRoute('HTTPS [::1]:443; SOCKS5 s:1080')).toBe('HTTPS [::1]:443; SOCKS5 s:1080')
  })

  it('sends anything it cannot read nowhere', () => {
    expect(cleanRoute('')).toBe(NOWHERE)
    expect(cleanRoute("PROXY a'; return 'DIRECT")).toBe(NOWHERE)
    expect(cleanRoute('BOGUS x:1')).toBe(NOWHERE)
  })
})

describe('PreviewNetwork', () => {
  it('asks for every open host, applies the script once, and again when a route changes', async () => {
    const applied: string[] = []
    const asked: string[] = []
    let corp = 'DIRECT'
    const network = new PreviewNetwork(
      { setProxy: async (config) => void applied.push(Buffer.from(config.pacScript.split(',')[1], 'base64').toString()) },
      async (url) => {
        asked.push(url)
        return url === 'https://esm.sh/' ? corp : 'DIRECT'
      },
      false,
    )
    await network.refresh()
    await network.refresh()
    expect(applied).toHaveLength(1)
    expect(asked).toHaveLength(OPEN_HOSTS.length * 2)
    corp = 'PROXY corp:8080'
    await network.refresh()
    expect(applied).toHaveLength(2)
    expect(route(applied[1], 'https://esm.sh/')).toBe('PROXY corp:8080')
  })

  it('treats a host it cannot resolve as closed, and tries again after a failed apply', async () => {
    let fail = true
    const applied: string[] = []
    const network = new PreviewNetwork(
      {
        setProxy: async (config) => {
          if (fail) throw new Error('no')
          applied.push(Buffer.from(config.pacScript.split(',')[1], 'base64').toString())
        },
      },
      async (url) => (url === 'https://unpkg.com/' ? Promise.reject(new Error('x')) : 'DIRECT'),
      false,
    )
    await expect(network.refresh()).rejects.toThrow('no')
    fail = false
    await network.refresh()
    expect(applied).toHaveLength(1)
    expect(route(applied[0], 'https://unpkg.com/')).toBe(NOWHERE)
  })
})
