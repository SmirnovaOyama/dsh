// Artifacts as the renderer sees them: every version is a tool item in the transcript.

import { AppWindow, Atom, Braces, FileText, Shapes, Workflow, type LucideIcon } from 'lucide-react'
import type { ArtifactType, ArtifactVersion, TranscriptItem } from '../shared/types'
import { t, type MessageKey } from './i18n'

export type ArtifactItem = Extract<TranscriptItem, { kind: 'tool' }> & { artifact: ArtifactVersion }

export const isArtifact = (item: TranscriptItem): item is ArtifactItem => item.kind === 'tool' && item.artifact !== undefined

/** Versions worth showing: finished ones, plus the one being written. */
const shown = (item: ArtifactItem) => item.status === 'done' || item.status === 'running'

/** Whether the conversation has an artifact worth listing; cheap enough to run on every update. */
export const anyArtifacts = (items: TranscriptItem[]) => items.some((i) => isArtifact(i) && shown(i))

/**
 * Every version of the artifact that this item belongs to, oldest first: the shown ones, and the last
 * attempt at a version that never got made, marked unfinished where it is listed. So the list stays the
 * same whichever version is open, and a version that stops or fails keeps its place.
 */
export function versionsOf(items: TranscriptItem[], item: ArtifactItem): ArtifactItem[] {
  const id = item.artifact.id
  const family = items.filter((i): i is ArtifactItem => isArtifact(i) && (i.id === item.id || (!!id && i.artifact.id === id)))
  const taken = new Set(family.filter(shown).map((i) => i.artifact.version))
  const attempts = new Set<string>()
  for (const i of [...family].reverse()) {
    if (shown(i) || taken.has(i.artifact.version)) continue
    taken.add(i.artifact.version)
    attempts.add(i.id)
  }
  return family.filter((i) => i.id === item.id || shown(i) || attempts.has(i.id))
}

/** The newest shown version of each artifact, in the order they were first made. */
export function latestArtifacts(items: TranscriptItem[]): ArtifactItem[] {
  const latest = new Map<string, ArtifactItem>()
  for (const item of items) {
    if (!isArtifact(item) || !shown(item)) continue
    const key = item.artifact.id || item.id
    latest.delete(key)
    latest.set(key, item)
  }
  const firstSeen = new Map<string, number>()
  items.forEach((item, index) => {
    if (isArtifact(item) && !firstSeen.has(item.artifact.id || item.id)) firstSeen.set(item.artifact.id || item.id, index)
  })
  return [...latest.entries()].sort((a, b) => (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0)).map(([, item]) => item)
}

const ICONS: Record<ArtifactType, LucideIcon> = { html: AppWindow, react: Atom, svg: Shapes, mermaid: Workflow, markdown: FileText, code: Braces }
export const artifactIcon = (type: ArtifactType) => ICONS[type] ?? Braces

export function typeLabel(artifact: ArtifactVersion): string {
  if (artifact.type === 'code' && artifact.language) return artifact.language
  return t(`artifact.type.${artifact.type}` as MessageKey)
}

/** Page text quoted for the agent inside a fence the text cannot close. */
export function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${text}\n${fence}`
}

export const hasPreview = (type: ArtifactType) => type !== 'code'

/** Kinds that render as a page of their own, so they can open in a browser or be sized like a device. */
export const isPage = (type: ArtifactType) => type === 'html' || type === 'react' || type === 'svg' || type === 'mermaid'

const EXTENSIONS: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb', rust: 'rs', kotlin: 'kt', csharp: 'cs', 'c#': 'cs',
  cpp: 'cpp', 'c++': 'cpp', shell: 'sh', bash: 'sh', zsh: 'sh', markdown: 'md', yaml: 'yml', golang: 'go',
}

export function fileNameFor(artifact: ArtifactVersion): string {
  const base = artifact.id || 'artifact'
  switch (artifact.type) {
    case 'html':
      return `${base}.html`
    case 'react':
      return `${base}.jsx`
    case 'svg':
      return `${base}.svg`
    case 'mermaid':
      return `${base}.mmd`
    case 'markdown':
      return `${base}.md`
    default: {
      const lang = (artifact.language ?? '').toLowerCase()
      return `${base}.${EXTENSIONS[lang] ?? (/^[a-z0-9]{1,6}$/.test(lang) ? lang : 'txt')}`
    }
  }
}

/** The language the code view highlights as. */
export function codeLanguage(artifact: ArtifactVersion): string {
  if (artifact.type === 'react') return 'jsx'
  if (artifact.type === 'markdown') return 'markdown'
  if (artifact.type === 'code') return artifact.language ?? 'text'
  if (artifact.type === 'mermaid') return 'text'
  return artifact.type
}

// ── what the preview frame loads ─────────────────────────────────

const REACT = 'https://esm.sh/react@18.3.1'
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'
const BABEL = 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js'
const TAILWIND = 'https://cdn.tailwindcss.com/3.4.16'

/** JSON that is safe inside a <script> element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

/**
 * Where a module specifier loads from, as page JavaScript: bare package names other than React load
 * from esm.sh and share the page's one copy of React. Babel applies it to real imports only, never to
 * text that merely says "from".
 */
export const ESM_SPECIFIER = `(spec) => /^(react|react-dom)(\\/|$)/.test(spec) || /^(https?:|blob:|data:|\\.|\\/)/.test(spec) ? spec : 'https://esm.sh/' + spec + (spec.includes('?') ? '&' : '?') + 'external=react,react-dom'`

const FRAME_STYLE = `html,body{margin:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC",sans-serif}
#dsh-error{display:none;margin:16px;padding:12px 14px;border-radius:8px;background:#fdf1ee;color:#9b2c1c;font:12.5px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap}`

export function reactPage(source: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${FRAME_STYLE}</style>
<script type="importmap">${scriptJson({
    imports: {
      react: REACT,
      'react/': `${REACT}/`,
      'react-dom': `https://esm.sh/react-dom@18.3.1?external=react`,
      'react-dom/client': `https://esm.sh/react-dom@18.3.1/client?external=react`,
    },
  })}</script>
<script src="${TAILWIND}"></script>
<script src="${BABEL}"></script>
</head><body><div id="root"></div><pre id="dsh-error"></pre>
<script type="module">
const show = (error) => { const box = document.getElementById('dsh-error'); box.textContent = String(error && error.stack || error); box.style.display = 'block'; window.dshReport && window.dshReport(error) }
const esm = ${ESM_SPECIFIER}
const setSource = (node) => { if (node && node.type === 'StringLiteral') node.value = esm(node.value) }
const imports = () => ({ visitor: {
  ImportDeclaration: (path) => setSource(path.node.source),
  ExportNamedDeclaration: (path) => setSource(path.node.source),
  ExportAllDeclaration: (path) => setSource(path.node.source),
  CallExpression: (path) => { if (path.node.callee.type === 'Import') setSource(path.node.arguments[0]) },
} })
try {
  const source = ${scriptJson(source)}
  const code = Babel.transform(source, { filename: 'App.tsx', presets: [['react', { runtime: 'automatic' }], ['typescript', { isTSX: true, allExtensions: true }]], plugins: [imports] }).code
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const [mod, React, { createRoot }] = await Promise.all([import(url), import('react'), import('react-dom/client')])
  const App = mod.default
  if (typeof App !== 'function') throw new Error('The module needs a default export that is a React component.')
  createRoot(document.getElementById('root')).render(React.createElement(App))
} catch (error) { show(error) }
</script></body></html>`
}

export function mermaidPage(source: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${FRAME_STYLE}
#out{display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}#out svg{max-width:100%;height:auto}</style>
</head><body><div id="out"></div><pre id="dsh-error"></pre>
<script type="module">
const show = (error) => { const box = document.getElementById('dsh-error'); box.textContent = String(error && error.message || error); box.style.display = 'block'; window.dshReport && window.dshReport(error) }
try {
  const { default: mermaid } = await import('${MERMAID}')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif' })
  const { svg } = await mermaid.render('dsh-diagram', ${scriptJson(source)})
  document.getElementById('out').innerHTML = svg
} catch (error) { show(error) }
</script></body></html>`
}

export function svgPage(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}svg{max-width:100%;max-height:100%;height:auto}</style></head><body>${source}</body></html>`
}

/** The page an artifact previews as, before the error bridge is added. */
export function pageFor(artifact: ArtifactVersion): string {
  switch (artifact.type) {
    case 'react':
      return reactPage(artifact.content)
    case 'svg':
      return svgPage(artifact.content)
    case 'mermaid':
      return mermaidPage(artifact.content)
    default:
      return artifact.content
  }
}

/**
 * A small script at the top of the page that talks to the app: it says when the page has loaded or
 * failed (so the person can ask the agent to fix it), passes Escape up so an expanded preview can
 * close, and hands web links to the app to offer instead of leaving the page. The page can only post
 * messages; the app treats them as text. It is one line, so line numbers in errors match the source.
 */
const BRIDGE = [
  '<script>(function(){',
  "var sent=0;function post(m){try{parent.postMessage(m,'*')}catch(_){}}",
  'function report(e){if(sent>=20)return;sent++;var m=e&&(e.stack||e.message)||String(e);post({dshArtifactError:String(m).slice(0,2000)})}',
  "window.dshReport=report;addEventListener('error',function(e){report(e.error||e.message)});addEventListener('unhandledrejection',function(e){report(e.reason)});",
  "var ce=console.error;console.error=function(){report(Array.prototype.map.call(arguments,function(a){return a&&a.message||String(a)}).join(' '));return ce.apply(console,arguments)};",
  "addEventListener('keydown',function(e){if(e.key==='Escape')post({dshArtifactKey:'Escape'})},true);",
  "addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented)return;var u;try{u=new URL(a.getAttribute('href'),location.href)}catch(_){return}",
  "if(u.protocol!=='http:'&&u.protocol!=='https:')return;e.preventDefault();post({dshArtifactOpen:u.href})});",
  "addEventListener('DOMContentLoaded',function(){post({dshArtifactReady:true})})",
  '})()</script>',
].join('')

export function withBridge(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + BRIDGE + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) return doctype[0] + BRIDGE + html.slice(doctype[0].length)
  return BRIDGE + html
}
