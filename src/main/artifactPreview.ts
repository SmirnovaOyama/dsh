// Artifact previews load from a scheme of their own, never inline in the app page, so they get a policy
// of their own: they may run scripts and load code from a few public CDNs, and nothing else. A page the
// model wrote cannot send what it knows anywhere, and the app keeps its own strict policy.

import { randomBytes } from 'node:crypto'

export const PREVIEW_SCHEME = 'dsh-artifact'

const CDNS = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh'

export const PREVIEW_POLICY = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDNS} https://cdn.tailwindcss.com`,
  `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
  `font-src data: ${CDNS} https://fonts.gstatic.com`,
  'img-src data: blob:',
  'media-src data: blob:',
  `connect-src ${CDNS}`,
  'worker-src blob:',
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const KEEP = 24
const MAX_PAGE = 4_000_000

/** The pages the preview frames can load, each under an address nobody can guess. */
export class PreviewPages {
  private pages = new Map<string, string>()

  add(html: unknown): string {
    const page = String(html ?? '')
    if (page.length > MAX_PAGE) throw new Error('The page is too large to preview.')
    const token = randomBytes(16).toString('hex')
    this.pages.set(token, page)
    // Only the newest few are kept; an older frame that reloads shows a short note instead.
    for (const old of this.pages.keys()) {
      if (this.pages.size <= KEEP) break
      this.pages.delete(old)
    }
    return `${PREVIEW_SCHEME}://page/${token}.html`
  }

  respond(url: string): Response {
    const match = /^dsh-artifact:\/\/page\/([0-9a-f]{32})\.html$/.exec(url)
    const page = match ? this.pages.get(match[1]) : undefined
    if (page === undefined) return new Response('This preview is no longer available. Reload it.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    return new Response(page, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PREVIEW_POLICY, 'Cache-Control': 'no-store' },
    })
  }
}

/** The same policy as a meta tag, for a page opened in the person's browser. */
export function withPolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_POLICY}">`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) return `${doctype[0]}<head>${meta}</head>${html.slice(doctype[0].length)}`
  return `<head>${meta}</head>${html}`
}
