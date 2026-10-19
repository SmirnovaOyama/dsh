// Artifact previews may reach a few public CDNs and nothing else. Their content policy covers every way a
// page can fetch, except WebRTC, which Chromium leaves outside it: a page could open a STUN or TURN
// connection to any host with no click. So WebRTC in the app may only travel through a proxy, and the
// app's pages get a proxy setting under which every host but those CDNs leads nowhere. The CDNs keep
// whatever route the system would give them, so a proxy the person relies on still applies there.

/** Hosts a preview may load from: the CDNs in its policy, and where Chromium fetches spelling dictionaries. */
export const OPEN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'redirector.gvt1.com',
]

/** A port nothing listens on, so a connection through it fails at once. */
export const NOWHERE = 'PROXY 127.0.0.1:9'

/** How the system would reach each open host, as a PAC result such as "DIRECT" or "PROXY host:port". */
export type Routes = Record<string, string>

/**
 * The proxy script: open hosts go the way the system sends them, the loopback address only while
 * developing (the dev server lives there), and everything else nowhere.
 */
export function pacScript(routes: Routes, loopback: boolean): string {
  const dictionaries = routes['redirector.gvt1.com'] ?? NOWHERE
  return `function FindProxyForURL(url, host) {
  var routes = ${JSON.stringify(routes)};
  host = host.toLowerCase();
  if (${loopback} && (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')) return 'DIRECT';
  if (Object.prototype.hasOwnProperty.call(routes, host)) return routes[host];
  if (shExpMatch(host, '*.gvt1.com')) return ${JSON.stringify(dictionaries)};
  return ${JSON.stringify(NOWHERE)};
}`
}

/** A PAC result is a list of "DIRECT", "PROXY h:p", "HTTPS h:p", "SOCKS h:p" and the like; anything else goes nowhere. */
export function cleanRoute(route: string): string {
  const parts = route
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^(DIRECT|(PROXY|HTTPS|SOCKS4?|SOCKS5|QUIC) [A-Za-z0-9.\-:[\]]+)$/.test(part))
  return parts.length ? parts.join('; ') : NOWHERE
}

interface ProxySession {
  setProxy(config: { mode: 'pac_script'; pacScript: string }): Promise<void>
}

/** Keeps the app session's proxy script in step with the system's routes to the open hosts. */
export class PreviewNetwork {
  private current = ''

  constructor(
    private readonly session: ProxySession,
    /** Asks how the system would reach a URL, from a session the app never changes. */
    private readonly systemRoute: (url: string) => Promise<string>,
    private readonly loopback: boolean,
  ) {}

  /** Re-reads the system's routes and applies the script if they changed; cheap enough to run per preview. */
  async refresh(): Promise<void> {
    const routes: Routes = {}
    for (const host of OPEN_HOSTS) routes[host] = cleanRoute(await this.systemRoute(`https://${host}/`).catch(() => NOWHERE))
    const script = pacScript(routes, this.loopback)
    if (script === this.current) return
    await this.session.setProxy({ mode: 'pac_script', pacScript: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(script).toString('base64')}` })
    this.current = script
  }
}
