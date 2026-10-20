// Artifact previews may reach a few public CDNs and nothing else. Their content policy covers every way a
// page can fetch, except WebRTC, which Chromium leaves outside it: a page could open a TURN connection to
// any host, the person's own machine included, with no click. So WebRTC in the app may only travel through
// a proxy, and the app's only proxy is a gate in the main process that opens tunnels to those CDNs and to
// nothing else. Each tunnel takes the route the system would give that CDN, so a proxy the person relies
// on still applies there. Chromium sends the loopback and link-local addresses around any proxy unless it
// is told otherwise, so it is told otherwise.

import net from 'node:net'

/** Hosts a preview may load from: the CDNs in its content policy. */
export const OPEN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]

/** Where requests go if the gate could not start: a port nothing listens on, so they fail at once. */
const NOWHERE = 9

/**
 * The proxy settings for the app's session: everything through the gate, nothing around it, not even the
 * loopback address. Only the dev server, while developing, is reached directly.
 */
export function gateProxy(port: number | null, devHost?: string) {
  return {
    mode: 'fixed_servers' as const,
    proxyRules: `127.0.0.1:${port ?? NOWHERE}`,
    proxyBypassRules: [...(devHost ? [devHost] : []), '<-loopback>'].join(','),
  }
}

/** The CDN a tunnel request asks for, if it is one the gate opens: `CONNECT host:443`, nothing else. */
export function allowedTarget(head: string, open: readonly string[] = OPEN_HOSTS): string | null {
  const match = /^CONNECT ([^\s:/]+):443 HTTP\/1\.[01]\r?$/i.exec(head.split('\n', 1)[0])
  if (!match) return null
  const host = match[1].toLowerCase().replace(/\.$/, '')
  return open.includes(host) ? host : null
}

export type Hop = { kind: 'direct' } | { kind: 'proxy' | 'socks'; host: string; port: number }

/** The hops a system route offers, in order, keeping the kinds the gate can follow: DIRECT, PROXY and SOCKS5. */
export function hops(route: string): Hop[] {
  const out: Hop[] = []
  for (const part of route.split(';')) {
    const entry = part.trim()
    if (/^DIRECT$/i.test(entry)) {
      out.push({ kind: 'direct' })
      continue
    }
    const match = /^(PROXY|SOCKS5) (\[[0-9a-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/i.exec(entry)
    if (!match) continue
    const port = Number(match[3])
    if (port < 1 || port > 65535) continue
    out.push({ kind: match[1].toUpperCase() === 'PROXY' ? 'proxy' : 'socks', host: match[2].replace(/^\[|\]$/g, ''), port })
  }
  return out
}

const HEAD_LIMIT = 8192
const WAIT = 15_000

/** Reads up to the blank line that ends a request or response head; null if it is too long, too slow or cut off. */
function readHead(socket: net.Socket): Promise<{ head: string; rest: Buffer } | null> {
  return new Promise((resolve) => {
    let buffered: Buffer = Buffer.alloc(0)
    const done = (value: { head: string; rest: Buffer } | null) => {
      socket.off('data', onData)
      socket.off('end', onEnd)
      socket.off('error', onEnd)
      clearTimeout(timer)
      // Nothing more is read until the socket is piped, so no bytes go missing in between.
      socket.pause()
      resolve(value)
    }
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf('\r\n\r\n')
      if (end !== -1) done({ head: buffered.subarray(0, end).toString('latin1'), rest: buffered.subarray(end + 4) })
      else if (buffered.length > HEAD_LIMIT) done(null)
    }
    const onEnd = () => done(null)
    const timer = setTimeout(onEnd, WAIT)
    socket.on('data', onData)
    socket.once('end', onEnd)
    socket.once('error', onEnd)
    socket.resume()
  })
}

/** Reads exactly `size` bytes after what was already read, or null if the socket ends first. */
function readBytes(socket: net.Socket, size: number, buffered: Buffer = Buffer.alloc(0)): Promise<{ bytes: Buffer; rest: Buffer } | null> {
  if (buffered.length >= size) return Promise.resolve({ bytes: buffered.subarray(0, size), rest: buffered.subarray(size) })
  return new Promise((resolve) => {
    let got: Buffer = buffered
    const done = (value: { bytes: Buffer; rest: Buffer } | null) => {
      socket.off('data', onData)
      socket.off('end', onEnd)
      socket.off('error', onEnd)
      clearTimeout(timer)
      // Nothing more is read until the socket is piped, so no bytes go missing in between.
      socket.pause()
      resolve(value)
    }
    const onData = (chunk: Buffer) => {
      got = Buffer.concat([got, chunk])
      if (got.length >= size) done({ bytes: got.subarray(0, size), rest: got.subarray(size) })
    }
    const onEnd = () => done(null)
    const timer = setTimeout(onEnd, WAIT)
    socket.on('data', onData)
    socket.once('end', onEnd)
    socket.once('error', onEnd)
    socket.resume()
  })
}

function connect(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => socket.destroy(new Error('Timed out')), WAIT)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.off('error', reject)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** Opens a tunnel to host:443 through one hop. Bytes that arrive past the hop's answer are put back first. */
async function tunnel(hop: Hop, host: string): Promise<net.Socket> {
  if (hop.kind === 'direct') return connect(host, 443)
  const socket = await connect(hop.host, hop.port)
  try {
    if (hop.kind === 'proxy') {
      socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`)
      const answer = await readHead(socket)
      if (!answer || !/^HTTP\/1\.[01] 200\b/.test(answer.head)) throw new Error('The proxy refused the tunnel.')
      if (answer.rest.length) socket.unshift(answer.rest)
      return socket
    }
    // SOCKS5 without a password: a greeting, then a connect by name.
    socket.write(Buffer.from([5, 1, 0]))
    const greeting = await readBytes(socket, 2)
    if (!greeting || greeting.bytes[0] !== 5 || greeting.bytes[1] !== 0) throw new Error('The SOCKS proxy refused.')
    const name = Buffer.from(host, 'latin1')
    socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([1, 187])]))
    const reply = await readBytes(socket, 5, greeting.rest)
    if (!reply || reply.bytes[0] !== 5 || reply.bytes[1] !== 0) throw new Error('The SOCKS proxy refused.')
    // The bound address that ends the reply: IPv4, IPv6 or a name, then the port. Its first byte is already read.
    const left = reply.bytes[3] === 1 ? 5 : reply.bytes[3] === 4 ? 17 : reply.bytes[3] === 3 ? reply.bytes[4] + 2 : -1
    if (left < 0) throw new Error('The SOCKS proxy answered oddly.')
    const end = await readBytes(socket, left, reply.rest)
    if (!end) throw new Error('The SOCKS proxy hung up.')
    if (end.rest.length) socket.unshift(end.rest)
    return socket
  } catch (error) {
    socket.destroy()
    throw error
  }
}

/** The gate: a proxy on the loopback address that tunnels to the open hosts by the system's routes, and refuses the rest. */
export class PreviewGate {
  private readonly server = net.createServer((client) => void this.serve(client))

  constructor(
    /** Asks how the system would reach a URL, from a session the app never changes. */
    private readonly systemRoute: (url: string) => Promise<string>,
    private readonly open: readonly string[] = OPEN_HOSTS,
  ) {}

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject)
        resolve((this.server.address() as net.AddressInfo).port)
      })
    })
  }

  close(): void {
    this.server.close()
  }

  private async serve(client: net.Socket): Promise<void> {
    client.on('error', () => client.destroy())
    const request = await readHead(client)
    const host = request && allowedTarget(request.head, this.open)
    if (!request || !host) {
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      return
    }
    const route = await this.systemRoute(`https://${host}/`).catch(() => 'DIRECT')
    let upstream: net.Socket | null = null
    for (const hop of hops(route)) {
      upstream = await tunnel(hop, host).catch(() => null)
      if (upstream) break
    }
    if (!upstream || client.destroyed) {
      upstream?.destroy()
      client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      return
    }
    const remote = upstream
    remote.on('error', () => client.destroy())
    client.on('close', () => remote.destroy())
    remote.on('close', () => client.destroy())
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (request.rest.length) remote.write(request.rest)
    client.pipe(remote)
    remote.pipe(client)
  }
}
