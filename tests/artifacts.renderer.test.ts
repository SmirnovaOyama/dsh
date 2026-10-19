import { describe, expect, it } from 'vitest'
import { ESM_SPECIFIER, anyArtifacts, fenced, fileNameFor, latestArtifacts, pageFor, versionsOf, withBridge, type ArtifactItem } from '../src/renderer/artifacts'
import type { ArtifactVersion, TranscriptItem } from '../src/shared/types'

// Type-checked with the renderer (tsconfig.json), since these helpers live beside the DOM code.

const page: ArtifactVersion = { id: 'timer', title: '番茄鐘', type: 'html', content: '<!doctype html><html><head></head><body><b>25:00</b></body></html>', version: 1 }

describe('artifacts in the renderer', () => {
  const item = (id: string, artifact: ArtifactVersion, status: ArtifactItem['status'] = 'done'): ArtifactItem => ({
    kind: 'tool',
    id,
    callId: id,
    name: 'artifact',
    target: artifact.title,
    status,
    artifact,
  })
  const v2 = { ...page, content: '<p>2</p>', version: 2 }
  const doc: ArtifactVersion = { id: 'notes', title: 'Notes', type: 'markdown', content: '# Hi', version: 1 }
  const items: TranscriptItem[] = [item('a', page), item('b', doc), item('c', { ...v2, version: 3 }, 'error'), item('d', v2), item('e', { ...v2, version: 3 }, 'running')]

  it('lists every version that is done or being written', () => {
    expect(versionsOf(items, items[0] as ArtifactItem).map((i) => i.id)).toEqual(['a', 'd', 'e'])
    expect(versionsOf(items, items[2] as ArtifactItem).map((i) => i.id)).toEqual(['a', 'c', 'd', 'e'])
  })

  it('keeps a stopped version in the list from any version, unless that version was made again', () => {
    const stopped = [item('a', page), item('s', v2, 'stopped')]
    expect(versionsOf(stopped, stopped[0] as ArtifactItem).map((i) => i.id)).toEqual(['a', 's'])
    expect(versionsOf(stopped, stopped[1] as ArtifactItem).map((i) => i.id)).toEqual(['a', 's'])
    const redone = [...stopped, item('d', v2)]
    expect(versionsOf(redone, redone[0] as ArtifactItem).map((i) => i.id)).toEqual(['a', 'd'])
  })

  it('lists the newest version of each artifact in the order they were made', () => {
    expect(latestArtifacts(items).map((i) => i.id)).toEqual(['e', 'b'])
  })

  it('names saved files by type', () => {
    expect(fileNameFor(page)).toBe('timer.html')
    expect(fileNameFor({ ...page, type: 'mermaid' })).toBe('timer.mmd')
    expect(fileNameFor({ ...page, type: 'code', language: 'Python' })).toBe('timer.py')
    expect(fileNameFor({ ...page, type: 'code', language: 'objective c' })).toBe('timer.txt')
  })

  it('knows when there is an artifact worth listing', () => {
    expect(anyArtifacts(items)).toBe(true)
    expect(anyArtifacts([item('x', page, 'error')])).toBe(false)
  })

  it('loads bare imports from esm.sh but leaves React, URLs and relative paths alone', () => {
    const esm = new Function(`return ${ESM_SPECIFIER}`)() as (spec: string) => string
    expect(esm('react')).toBe('react')
    expect(esm('react-dom/client')).toBe('react-dom/client')
    expect(esm('canvas-confetti')).toBe('https://esm.sh/canvas-confetti?external=react,react-dom')
    expect(esm('lodash-es?bundle')).toBe('https://esm.sh/lodash-es?bundle&external=react,react-dom')
    expect(esm('./local')).toBe('./local')
    expect(esm('https://cdn.example/x.js')).toBe('https://cdn.example/x.js')
  })

  it('rewrites only real imports in a React page, never text that says "from"', () => {
    const html = pageFor({ ...page, type: 'react', content: '<p>Translated from "Le Petit Prince"</p>' })
    expect(html).toContain('ImportDeclaration')
    expect(html).not.toContain('esm.sh/Le Petit Prince')
  })

  it('keeps the source from closing the script it sits in', () => {
    const html = pageFor({ ...page, type: 'mermaid', content: 'graph TD\nA-->B</script><script>alert(1)</script>' })
    expect(html).not.toContain('</script><script>alert(1)')
    expect(pageFor({ ...page, type: 'react', content: 'export default () => "</script>"' })).not.toContain('"</script>"')
  })

  it('puts the error bridge first in the page without moving any line', () => {
    expect(withBridge(page.content).startsWith('<!doctype html><html><head><script>')).toBe(true)
    expect(withBridge('<!DOCTYPE html><p>x</p>').startsWith('<!DOCTYPE html><script>')).toBe(true)
    expect(withBridge('<p>x</p>').startsWith('<script>')).toBe(true)
    expect(withBridge('<header>x</header>').startsWith('<script>')).toBe(true)
    const multi = '<!doctype html>\n<html>\n<head>\n<title>t</title>\n</head>\n<body>\n<script>boom()</script>\n</body>\n</html>'
    expect(withBridge(multi).split('\n').length).toBe(multi.split('\n').length)
  })

  it('fences page text so it cannot close the fence early', () => {
    expect(fenced('TypeError: x')).toBe('```\nTypeError: x\n```')
    expect(fenced('a ``` b ````` c')).toBe('``````\na ``` b ````` c\n``````')
  })
})
