// Artifacts as the renderer sees them: every version is a tool item in the transcript.

import { AppWindow, Atom, Code, FileText, Image, type LucideIcon } from 'lucide-react'
import type { ArtifactType, ArtifactVersion, TranscriptItem } from '../shared/types'
import { t, type MessageKey } from './i18n'

export type ArtifactItem = Extract<TranscriptItem, { kind: 'tool' }> & { artifact: ArtifactVersion }

export const isArtifact = (item: TranscriptItem): item is ArtifactItem => item.kind === 'tool' && item.artifact !== undefined

/** Versions worth showing: finished ones, plus the one being written. */
const shown = (item: ArtifactItem) => item.status === 'done' || item.status === 'running'

/** Every shown version of the artifact that this item belongs to, oldest first. */
export function versionsOf(items: TranscriptItem[], item: ArtifactItem): ArtifactItem[] {
  const id = item.artifact.id
  return items.filter((i): i is ArtifactItem => isArtifact(i) && (i.id === item.id || (!!id && i.artifact.id === id && shown(i))))
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

const ICONS: Record<ArtifactType, LucideIcon> = { html: AppWindow, react: Atom, svg: Image, markdown: FileText, code: Code }
export const artifactIcon = (type: ArtifactType) => ICONS[type] ?? Code

export function typeLabel(artifact: ArtifactVersion): string {
  if (artifact.type === 'code' && artifact.language) return artifact.language
  return t(`artifact.type.${artifact.type}` as MessageKey)
}

export const hasPreview = (type: ArtifactType) => type !== 'code'

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
  return artifact.type
}

// ── what the preview frame loads ─────────────────────────────────

const REACT = 'https://esm.sh/react@18.3.1'
const BABEL = 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js'
const TAILWIND = 'https://cdn.tailwindcss.com/3.4.16'

/** JSON that is safe inside a <script> element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

/** Bare imports other than React load from esm.sh, sharing the page's one copy of React. */
export function resolveImports(source: string): string {
  return source.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"./][^'"]*)\2/g, (whole, lead: string, quote: string, spec: string) => {
    if (/^(react|react-dom)(\/|$)/.test(spec) || /^https?:/.test(spec)) return whole
    return `${lead}${quote}https://esm.sh/${spec}?external=react,react-dom${quote}`
  })
}

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
const show = (error) => { const box = document.getElementById('dsh-error'); box.textContent = String(error && error.stack || error); box.style.display = 'block' }
window.addEventListener('error', (e) => show(e.error || e.message))
window.addEventListener('unhandledrejection', (e) => show(e.reason))
try {
  const source = ${scriptJson(resolveImports(source))}
  const code = Babel.transform(source, { filename: 'App.tsx', presets: [['react', { runtime: 'automatic' }], ['typescript', { isTSX: true, allExtensions: true }]] }).code
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const [mod, React, { createRoot }] = await Promise.all([import(url), import('react'), import('react-dom/client')])
  const App = mod.default
  if (typeof App !== 'function') throw new Error('The module needs a default export that is a React component.')
  createRoot(document.getElementById('root')).render(React.createElement(App))
} catch (error) { show(error) }
</script></body></html>`
}

export function svgPage(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}svg{max-width:100%;max-height:100%;height:auto}</style></head><body>${source}</body></html>`
}
