import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freeName, safeFileName, saveToFolder, writeTempPage } from '../src/main/artifactFiles'
import { prepareToolCall } from '../src/main/tools'
import { PreviewPages, withPolicy } from '../src/main/artifactPreview'
import { artifactNote } from '../src/main/agent'
import { draftArtifact, nextArtifact, partialField, streamedCommand, viewArtifact } from '../src/main/tools/artifact'
import { ToolError } from '../src/main/tools/paths'
import type { ArtifactVersion } from '../src/shared/types'

const page: ArtifactVersion = { id: 'timer', title: '番茄鐘', type: 'html', content: '<!doctype html><html><head></head><body><b>25:00</b></body></html>', version: 1 }
const lookup = (...versions: ArtifactVersion[]) => (id: string) => versions.filter((v) => v.id === id).at(-1)

describe('nextArtifact', () => {
  it('creates the first version', () => {
    const made = nextArtifact({ command: 'create', id: 'timer', title: ' 番茄鐘 ', type: 'html', content: page.content }, lookup())
    expect(made).toEqual(page)
  })

  it('keeps a language only for code', () => {
    expect(nextArtifact({ command: 'create', id: 'a', title: 'A', type: 'code', language: 'python', content: 'x' }, lookup()).language).toBe('python')
    expect(nextArtifact({ command: 'create', id: 'b', title: 'B', type: 'svg', language: 'python', content: '<svg/>' }, lookup()).language).toBeUndefined()
  })

  it('refuses bad ids, types, empty content and a second create', () => {
    expect(() => nextArtifact({ command: 'create', id: 'Bad Id', title: 'x', type: 'html', content: 'x' }, lookup())).toThrow(ToolError)
    expect(() => nextArtifact({ command: 'create', id: 'x', title: 'x', type: 'pdf', content: 'x' }, lookup())).toThrow(/"type"/)
    expect(() => nextArtifact({ command: 'create', id: 'x', title: 'x', type: 'html', content: '  ' }, lookup())).toThrow(/content/)
    expect(() => nextArtifact({ command: 'create', id: 'timer', title: 'x', type: 'html', content: 'x' }, lookup(page))).toThrow(/already exists/)
  })

  it('updates one exact match into a new version', () => {
    const next = nextArtifact({ command: 'update', id: 'timer', old_str: '25:00', new_str: '50:00' }, lookup(page))
    expect(next).toMatchObject({ id: 'timer', title: '番茄鐘', type: 'html', version: 2 })
    expect(next.content).toContain('<b>50:00</b>')
  })

  it('refuses an update that matches nothing or more than once', () => {
    expect(() => nextArtifact({ command: 'update', id: 'timer', old_str: 'nope', new_str: 'x' }, lookup(page))).toThrow(/not found/)
    expect(() => nextArtifact({ command: 'update', id: 'timer', old_str: 'html', new_str: 'x' }, lookup(page))).toThrow(/more than once/)
    expect(() => nextArtifact({ command: 'update', id: 'ghost', old_str: 'a', new_str: 'b' }, lookup(page))).toThrow(/no artifact/)
  })

  it('rewrites the whole content and can rename', () => {
    const next = nextArtifact({ command: 'rewrite', id: 'timer', title: '計時器', content: '<p>new</p>' }, lookup(page))
    expect(next).toEqual({ ...page, title: '計時器', content: '<p>new</p>', version: 2 })
  })

  it('lets a rewrite change the type, and keeps the language for code', () => {
    const code: ArtifactVersion = { id: 'calc', title: 'Calc', type: 'code', language: 'python', content: 'x = 1', version: 1 }
    expect(nextArtifact({ command: 'rewrite', id: 'calc', type: 'react', content: 'export default () => null' }, lookup(code))).toMatchObject({ type: 'react', version: 2 })
    expect(nextArtifact({ command: 'rewrite', id: 'calc', content: 'x = 2' }, lookup(code))).toMatchObject({ type: 'code', language: 'python' })
    expect(nextArtifact({ command: 'update', id: 'calc', old_str: '1', new_str: '3', type: 'html' }, lookup(code))).toMatchObject({ type: 'code', language: 'python' })
    expect(() => nextArtifact({ command: 'rewrite', id: 'calc', type: 'pdf', content: 'x' }, lookup(code))).toThrow(/"type"/)
  })
})

describe('viewArtifact', () => {
  const long: ArtifactVersion = { ...page, content: Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n' }

  it('numbers the lines of the latest version', () => {
    const view = viewArtifact({ command: 'view', id: 'timer' }, lookup(long))
    expect(view.lines).toBe(12)
    expect(view.text.split('\n')[0]).toBe('"timer" (番茄鐘), html, version 1, lines 1-12 of 12')
    expect(view.text).toContain(' 1\tline 1')
    expect(view.text).toContain('12\tline 12')
  })

  it('reads a window and says where to go on', () => {
    const view = viewArtifact({ command: 'view', id: 'timer', offset: 4, limit: 3 }, lookup(long))
    expect(view.lines).toBe(3)
    expect(view.text).toContain('4\tline 4')
    expect(view.text).not.toContain('line 7')
    expect(view.text).toMatch(/6 more lines\. Call view again with offset 7/)
  })

  it('refuses an artifact that does not exist', () => {
    expect(() => viewArtifact({ command: 'view', id: 'ghost' }, lookup(page))).toThrow(/no artifact/)
  })

  it('runs as a read with no approval and no new version', async () => {
    const prepared = await prepareToolCall('artifact', JSON.stringify({ command: 'view', id: 'timer' }), tmpdir(), lookup(page))
    expect(prepared.approval).toBeNull()
    expect(prepared.artifact).toBeUndefined()
    const result = await prepared.run({} as never)
    expect(result.info).toEqual({ lines: 1 })
  })
})

describe('artifactNote', () => {
  it('lists the newest finished version of each artifact', () => {
    const tool = (artifact: ArtifactVersion, status: 'done' | 'error' = 'done') => ({ kind: 'tool' as const, id: `${artifact.id}${artifact.version}${status}`, callId: '', name: 'artifact', target: '', status, artifact })
    const note = artifactNote([tool(page), tool({ ...page, version: 2 }), tool({ ...page, version: 3 }, 'error')])
    expect(note).toContain('- timer: 番茄鐘 (html, version 2)')
    expect(artifactNote([])).toBe('')
  })
})

describe('streaming an artifact', () => {
  it('reads string fields out of half-written JSON', () => {
    expect(partialField('{"id":"tim', 'id')).toBe('tim')
    expect(partialField('{"id":"timer","content":"<p>\\"hi\\"\\n\\u00e9', 'content')).toBe('<p>"hi"\né')
    expect(partialField('{"content":"ab\\', 'content')).toBe('ab')
    expect(partialField('{"content":"ab\\u00', 'content')).toBe('ab')
    expect(partialField('{"id":"x"', 'content')).toBeUndefined()
  })

  it('drafts a new artifact as it streams', () => {
    const draft = draftArtifact('{"command":"create","id":"timer","title":"番茄","type":"html","content":"<p>2', lookup())
    expect(draft).toEqual({ id: 'timer', title: '番茄', type: 'html', content: '<p>2', version: 1 })
  })

  it('keeps showing the latest version while an update streams', () => {
    const draft = draftArtifact('{"command":"update","id":"timer","old_str":"25', lookup(page))
    expect(draft).toMatchObject({ title: '番茄鐘', type: 'html', content: page.content, version: 2 })
  })

  it('falls back to code for an unknown type', () => {
    expect(draftArtifact('{"command":"create","id":"x","type":"pdf"', lookup()).type).toBe('code')
  })

  it('drafts by the same rules as the finished version', () => {
    expect(draftArtifact('{"command":"update","id":"timer","type":"svg","old_str":"25', lookup(page)).type).toBe('html')
    expect(draftArtifact('{"command":"rewrite","id":"timer","type":"svg","content":"<svg', lookup(page))).toMatchObject({ type: 'svg', content: '<svg', version: 2 })
  })

  it('knows the command only once it is written out', () => {
    expect(streamedCommand('{"command":"vi')).toBeUndefined()
    expect(streamedCommand('{"command" : "view","id":"x"')).toBe('view')
    expect(streamedCommand('{"id":"x","command":"rewrite"')).toBe('rewrite')
  })

  it('runs as a tool that needs no approval', async () => {
    const prepared = await prepareToolCall('artifact', JSON.stringify({ command: 'update', id: 'timer', old_str: '25:00', new_str: '5:00' }), tmpdir(), lookup(page))
    expect(prepared.approval).toBeNull()
    expect(prepared.artifact?.version).toBe(2)
    const result = await prepared.run({} as never)
    expect(result.text).toMatch(/Updated artifact "timer", now at version 2/)
  })
})

describe('saving artifacts', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dsh-art-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps file names inside the folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('..')).toBe('artifact.txt')
    expect(safeFileName('.hidden.html')).toBe('hidden.html')
    expect(safeFileName('a:b?.md')).toBe('a-b-.md')
    expect(safeFileName(undefined, 'x.html')).toBe('x.html')
  })

  it('never replaces a file that is already there', async () => {
    await writeFile(path.join(dir, 'timer.html'), 'mine')
    expect(await freeName(dir, 'timer.html')).toBe('timer-2.html')
    const saved = await saveToFolder(dir, 'timer.html', 'theirs')
    expect(saved).toEqual({ ok: true, path: 'timer-2.html' })
    expect(await readFile(path.join(dir, 'timer.html'), 'utf8')).toBe('mine')
    expect(await readFile(path.join(dir, 'timer-2.html'), 'utf8')).toBe('theirs')
  })

  it('says so when no folder is open', async () => {
    expect(await saveToFolder(null, 'a.md', 'x')).toEqual({ ok: false, error: 'No folder is open.' })
  })

  it('writes pages for the browser into a private folder, never over an earlier one', async () => {
    const first = await writeTempPage(dir, '../timer.jsx', '<p>1</p>')
    const second = await writeTempPage(dir, 'timer.jsx', '<p>2</p>')
    expect(path.dirname(first)).toBe(path.dirname(second))
    expect(path.basename(path.dirname(first))).toMatch(/^dsh-artifacts-/)
    expect(path.dirname(path.dirname(first))).toBe(dir)
    expect([path.basename(first), path.basename(second)]).toEqual(['timer.html', 'timer-2.html'])
    expect(await readFile(first, 'utf8')).toBe('<p>1</p>')
    expect(await readFile(second, 'utf8')).toBe('<p>2</p>')
    if (process.platform !== 'win32') expect((await stat(path.dirname(first))).mode & 0o777).toBe(0o700)
  })

  it('makes a new private folder if the old one was cleared', async () => {
    const first = await writeTempPage(dir, 'a.html', 'x')
    await rm(path.dirname(first), { recursive: true, force: true })
    const again = await writeTempPage(dir, 'a.html', 'y')
    expect(await readFile(again, 'utf8')).toBe('y')
  })
})

describe('preview pages', () => {
  it('serves a page once under an address nobody can guess, with its own policy', async () => {
    const pages = new PreviewPages()
    const url = pages.add('<p>hi</p>')
    expect(url).toMatch(/^dsh-artifact:\/\/page\/[0-9a-f]{32}\.html$/)
    const response = pages.respond(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-src 'none'")
    expect(await response.text()).toBe('<p>hi</p>')
    expect(pages.respond('dsh-artifact://page/0123456789abcdef0123456789abcdef.html').status).toBe(404)
    expect(pages.respond(`${url}?x`).status).toBe(404)
  })

  it('keeps only the newest pages', () => {
    const pages = new PreviewPages()
    const first = pages.add('1')
    for (let i = 0; i < 30; i++) pages.add(String(i))
    expect(pages.respond(first).status).toBe(404)
  })

  it('carries the policy into a page opened in the browser', () => {
    expect(withPolicy('<html><head><title>t</title></head></html>')).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/)
    expect(withPolicy('<!doctype html><p>x</p>')).toMatch(/^<!doctype html><head><meta http-equiv="Content-Security-Policy"/)
    expect(withPolicy('<header>x</header>')).toMatch(/^<head><meta /)
  })
})
