import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { OPEN_HOSTS, PreviewGate, allowedTarget, gateProxy, hops } from '../src/main/previewNetwork'

describe('gateProxy', () => {
  it('sends everything through the gate, the loopback address included', () => {
    expect(gateProxy(4321)).toEqual({ mode: 'fixed_servers', proxyRules: '127.0.0.1:4321', proxyBypassRules: '<-loopback>' })
  })

  it('goes nowhere if the gate did not start, and lets only the dev server around it', () => {
    expect(gateProxy(null, 'localhost')).toEqual({ mode: 'fixed_servers', proxyRules: '127.0.0.1:9', proxyBypassRules: 'localhost,<-loopback>' })
  })
})

describe('allowedTarget', () => {
  it('opens a tunnel to a CDN on 443 and nothing else', () => {
    expect(allowedTarget('CONNECT esm.sh:443 HTTP/1.1\r\nHost: esm.sh:443')).toBe('esm.sh')
    expect(allowedTarget('CONNECT ESM.sh.:443 HTTP/1.1')).toBe('esm.sh')
    expect(allowedTarget('CONNECT esm.sh:80 HTTP/1.1')).toBeNull()
    expect(allowedTarget('CONNECT evil.example:443 HTTP/1.1')).toBeNull()
    expect(allowedTarget('CONNECT esm.sh.evil.example:443 HTTP/1.1')).toBeNull()
    expect(allowedTarget('CONNECT 127.0.0.1:443 HTTP/1.1')).toBeNull()
    expect(allowedTarget('CONNECT [::1]:443 HTTP/1.1')).toBeNull()
    expect(allowedTarget('GET http://esm.sh/ HTTP/1.1')).toBeNull()
    expect(allowedTarget('CONNECT esm.sh:443 HTTP/1.1 extra')).toBeNull()
  })
})

describe('hops', () => {
  it('reads the routes the gate can follow, in order', () => {
    expect(hops('PROXY corp:8080; SOCKS5 [::1]:1080; DIRECT')).toEqual([
      { kind: 'proxy', host: 'corp', port: 8080 },
      { kind: 'socks', host: '::1', port: 1080 },
      { kind: 'direct' },
    ])
  })

  it('skips what it cannot follow', () => {
    expect(hops('HTTPS secure:443; SOCKS4 old:1080; PROXY bad host:1; PROXY p:99999; QUIC q:443')).toEqual([])
    expect(hops('')).toEqual([])
  })
})

/** A stand-in for the person's own proxy: answers CONNECT (or SOCKS5) and then echoes what comes through. */
function fakeProxy(kind: 'proxy' | 'socks', refuse = false) {
  const asked: string[] = []
  const server = net.createServer((socket) => {
    socket.on('error', () => socket.destroy())
    socket.once('data', (first) => {
      if (kind === 'proxy') {
        asked.push(first.toString('latin1').split('\r\n')[0])
        if (refuse) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        socket.pipe(socket)
        return
      }
      socket.write(Buffer.from([5, 0]))
      socket.once('data', (request) => {
        const length = request[4]
        asked.push(`${request.subarray(5, 5 + length).toString('latin1')}:${request.readUInt16BE(5 + length)}`)
        socket.write(Buffer.from([5, refuse ? 2 : 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        if (refuse) return socket.end()
        socket.pipe(socket)
      })
    })
  })
  return new Promise<{ port: number; asked: string[]; close(): void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, asked, close: () => server.close() })),
  )
}

/** Asks the gate for a tunnel and, if it opens, sends a word through it; returns the answer and the echo. */
function ask(port: number, head: string): Promise<{ status: string; echo: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => socket.write(head))
    let got = ''
    socket.on('data', (chunk) => {
      got += chunk.toString('latin1')
      if (got.startsWith('HTTP/1.1 200') && got.endsWith('\r\n\r\n')) socket.write('ping')
      if (got.endsWith('ping')) socket.end()
    })
    socket.on('close', () => resolve({ status: got.split('\r\n')[0], echo: got.split('\r\n\r\n')[1] ?? '' }))
    socket.on('error', reject)
  })
}

describe('PreviewGate', () => {
  const cleanup: (() => void)[] = []
  afterEach(() => cleanup.splice(0).forEach((done) => done()))

  async function gateVia(route: string) {
    const gate = new PreviewGate(async () => route)
    cleanup.push(() => gate.close())
    return gate.listen()
  }

  it('tunnels to a CDN through the proxy the system would use', async () => {
    const upstream = await fakeProxy('proxy')
    cleanup.push(upstream.close)
    const port = await gateVia(`PROXY 127.0.0.1:${upstream.port}`)
    expect(await ask(port, 'CONNECT esm.sh:443 HTTP/1.1\r\nHost: esm.sh:443\r\n\r\n')).toEqual({ status: 'HTTP/1.1 200 Connection Established', echo: 'ping' })
    expect(upstream.asked).toEqual(['CONNECT esm.sh:443 HTTP/1.1'])
  })

  it('follows a SOCKS5 route too', async () => {
    const upstream = await fakeProxy('socks')
    cleanup.push(upstream.close)
    const port = await gateVia(`SOCKS5 127.0.0.1:${upstream.port}`)
    expect(await ask(port, 'CONNECT unpkg.com:443 HTTP/1.1\r\n\r\n')).toEqual({ status: 'HTTP/1.1 200 Connection Established', echo: 'ping' })
    expect(upstream.asked).toEqual(['unpkg.com:443'])
  })

  it('tries the next route when one refuses, and says so when none works', async () => {
    const refusing = await fakeProxy('proxy', true)
    const working = await fakeProxy('socks')
    cleanup.push(refusing.close, working.close)
    const port = await gateVia(`PROXY 127.0.0.1:${refusing.port}; SOCKS5 127.0.0.1:${working.port}`)
    expect((await ask(port, 'CONNECT fonts.gstatic.com:443 HTTP/1.1\r\n\r\n')).status).toBe('HTTP/1.1 200 Connection Established')
    const dead = await gateVia(`PROXY 127.0.0.1:${refusing.port}`)
    expect((await ask(dead, 'CONNECT fonts.gstatic.com:443 HTTP/1.1\r\n\r\n')).status).toBe('HTTP/1.1 502 Bad Gateway')
  })

  it('refuses every other host, port and kind of request without going anywhere', async () => {
    const upstream = await fakeProxy('proxy')
    cleanup.push(upstream.close)
    const port = await gateVia(`PROXY 127.0.0.1:${upstream.port}`)
    for (const head of [
      'CONNECT evil.example:443 HTTP/1.1\r\n\r\n',
      'CONNECT 127.0.0.1:3478 HTTP/1.1\r\n\r\n',
      'CONNECT esm.sh:80 HTTP/1.1\r\n\r\n',
      'GET http://esm.sh/ HTTP/1.1\r\nHost: esm.sh\r\n\r\n',
    ]) {
      expect((await ask(port, head)).status).toBe('HTTP/1.1 403 Forbidden')
    }
    expect(upstream.asked).toEqual([])
  })

  it('opens only lower-case host names, as the requests are compared that way', () => {
    expect(OPEN_HOSTS).toContain('cdn.jsdelivr.net')
    expect(OPEN_HOSTS.every((host) => host === host.toLowerCase())).toBe(true)
  })
})
