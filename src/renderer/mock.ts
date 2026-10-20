// A demo of the main process for the browser preview (npm run dev:web) and screenshots.
// Nothing here touches files or the network. Query parameters pick a starting state:
//   ?nokey  ?nofolder  ?perm=edit  ?perm=command  ?perm=plan  ?running  ?todos  ?queue  ?theme=dark  ?platform=win32  ?lang=en

import {
  DEFAULT_SETTINGS,
  EMPTY_USAGE,
  type AgentEvent,
  type DiffLine,
  type DshApi,
  type FileChange,
  type FileRef,
  type PermissionDecision,
  type PermissionRequest,
  type QueuedMessage,
  type SessionData,
  type SessionMeta,
  type Settings,
  type SlashCommand,
  type Todo,
  type TranscriptItem,
  type WorkspaceInfo,
} from '../shared/types'

const params = new URLSearchParams(location.search)
const HOME = '/Users/anya'
const MIN = 60_000

const workspaces: Record<string, WorkspaceInfo> = {
  [`${HOME}/Projects/dsh`]: { path: `${HOME}/Projects/dsh`, name: 'dsh', branch: 'main', isGitRepo: true },
  [`${HOME}/Projects/oyama-tracker`]: { path: `${HOME}/Projects/oyama-tracker`, name: 'oyama-tracker', branch: 'dev', isGitRepo: true },
  [`${HOME}/Documents/notes`]: { path: `${HOME}/Documents/notes`, name: 'notes', branch: null, isGitRepo: false },
}
const DSH = `${HOME}/Projects/dsh`

let settings: Settings = {
  ...DEFAULT_SETTINGS,
  theme: params.get('theme') === 'dark' ? 'dark' : params.get('theme') === 'light' ? 'light' : DEFAULT_SETTINGS.theme,
  locale: params.get('lang') === 'en' ? 'en' : 'zh-Hant',
  recentWorkspaces: Object.keys(workspaces),
  projects: Object.keys(workspaces),
  lastWorkspace: params.has('nofolder') ? null : DSH,
}
let apiKey: string | null = params.has('nokey') ? null : 'sk-3f9c1a7e2b4d6c8e0a1b'
let workspace: WorkspaceInfo | null = settings.lastWorkspace ? workspaces[settings.lastWorkspace] : null

const listeners = new Set<(event: AgentEvent) => void>()
const emit = (event: AgentEvent) => {
  const copy = structuredClone(event)
  queueMicrotask(() => listeners.forEach((l) => l(copy)))
}

// ── demo conversations ──────────────────────────────────────────

const now = Date.now()
let seq = 0
const id = () => `m${++seq}`

const ctx = (no: number, newNo: number, text: string): DiffLine => ({ kind: 'ctx', oldNo: no, newNo, text })
const add = (newNo: number, text: string): DiffLine => ({ kind: 'add', newNo, text })
const del = (oldNo: number, text: string): DiffLine => ({ kind: 'del', oldNo, text })
const hunk = (text: string): DiffLine => ({ kind: 'hunk', text })

const sessionDiff: DiffLine[] = [
  hunk('@@ -18,9 +18,14 @@'),
  ctx(18, 18, "import { api } from '../api'"),
  add(19, "import { clock } from './clock'"),
  ctx(19, 20, ''),
  add(21, 'const REFRESH_MARGIN_MS = 60_000'),
  add(22, ''),
  del(20, 'export function needsRefresh(session: Session) {'),
  del(21, '  return session.expiresAt < Date.now()'),
  add(23, 'export function needsRefresh(session: Session, now = clock.now()) {'),
  add(24, '  return session.expiresAt - now < REFRESH_MARGIN_MS'),
  ctx(22, 25, '}'),
  ctx(23, 26, ''),
  ctx(24, 27, 'export async function refreshSession(session: Session) {'),
  del(25, '  if (!needsRefresh(session)) return session'),
  add(28, '  if (!needsRefresh(session)) {'),
  add(29, '    return session'),
  add(30, '  }'),
  ctx(26, 31, "  const next = await api.post('/auth/refresh', {"),
]

const clockSource = [
  '// 統一的時間來源，測試時可以換掉',
  'export interface Clock {',
  '  now(): number',
  '}',
  '',
  'export const realClock: Clock = {',
  '  now: () => Date.now(),',
  '}',
  '',
  'let current: Clock = realClock',
  '',
  'export const clock: Clock = {',
  '  now: () => current.now(),',
  '}',
  '',
  'export function useFakeClock(start: number) {',
  '  let t = start',
  '  current = { now: () => t }',
  '  const advance = (ms: number) => { t += ms }',
  '  return { advance, restore: () => { current = realClock } }',
  '}',
]
const sessionSource = [
  "import { api } from '../api'",
  "import { clock } from './clock'",
  '',
  'const REFRESH_MARGIN_MS = 60_000',
  '',
  'export interface Session {',
  '  token: string',
  '  expiresAt: number',
  '}',
  '',
  'export function needsRefresh(session: Session, now = clock.now()) {',
  '  return session.expiresAt - now < REFRESH_MARGIN_MS',
  '}',
  '',
  'export async function refreshSession(session: Session): Promise<Session> {',
  '  if (!needsRefresh(session)) {',
  '    return session',
  '  }',
  "  const next = await api.post('/auth/refresh', { token: session.token })",
  '  return { token: next.token, expiresAt: next.expiresAt }',
  '}',
]

/** The demo folder: a few real files and the shape of a small web app around them. */
const MOCK_FILES: Record<string, string> = {
  'src/auth/clock.ts': clockSource.join('\n') + '\n',
  'src/auth/session.ts': sessionSource.join('\n') + '\n',
  'package.json': '{\n  "name": "dsh-demo",\n  "private": true,\n  "scripts": {\n    "test": "vitest run"\n  }\n}\n',
  'README.md': '# dsh demo\n\n登入和工作階段的小範例。\n',
}
const MOCK_PATHS = [
  ...Object.keys(MOCK_FILES),
  'src/api.ts',
  'src/main.ts',
  'src/auth/login.ts',
  'src/auth/logout.ts',
  'src/components/Header.tsx',
  'src/components/LoginForm.tsx',
  'src/components/Avatar.tsx',
  'src/styles/app.css',
  'tests/auth/session.test.ts',
  'tests/auth/login.test.ts',
  'tsconfig.json',
  'vite.config.ts',
  '.gitignore',
].sort()

const clockDiff: DiffLine[] = [hunk('@@ -0,0 +1,21 @@'), ...clockSource.map((text, i) => add(i + 1, text))]

const testDiff: DiffLine[] = [
  hunk('@@ -1,4 +1,9 @@'),
  del(1, "import { describe, expect, it } from 'vitest'"),
  add(1, "import { afterEach, beforeEach, describe, expect, it } from 'vitest'"),
  ctx(2, 2, "import { needsRefresh } from '../../src/auth/session'"),
  add(3, "import { useFakeClock } from '../../src/auth/clock'"),
  ctx(3, 4, ''),
  ctx(4, 5, "describe('needsRefresh', () => {"),
  add(6, '  let fake: ReturnType<typeof useFakeClock>'),
  add(7, '  beforeEach(() => { fake = useFakeClock(0) })'),
  add(8, '  afterEach(() => fake.restore())'),
  add(9, ''),
  hunk('@@ -14,3 +19,8 @@'),
  ctx(14, 19, "  it('reuses a fresh session', () => {"),
  del(15, '    expect(needsRefresh({ expiresAt: Date.now() + 3_600_000 })).toBe(false)'),
  add(20, '    expect(needsRefresh({ expiresAt: 3_600_000 })).toBe(false)'),
  ctx(16, 21, '  })'),
  add(22, ''),
  add(23, "  it('refreshes within 60s of expiry', () => {"),
  add(24, '    fake.advance(3_550_000)'),
  add(25, '    expect(needsRefresh({ expiresAt: 3_600_000 })).toBe(true)'),
  add(26, '  })'),
]

const mainChanges: FileChange[] = [
  { path: 'src/auth/session.ts', status: 'modified', stats: { added: 8, removed: 3 }, lines: sessionDiff },
  { path: 'src/auth/clock.ts', status: 'added', stats: { added: 21, removed: 0 }, lines: clockDiff },
  { path: 'tests/auth/session.test.ts', status: 'modified', stats: { added: 12, removed: 2 }, lines: testDiff },
]

const answer = `找到原因了，\`needsRefresh()\` 用 \`expiresAt < Date.now()\` 判斷，要等 token 已經過期才去更新，這段空檔送出的請求都會被當成沒登入，畫面就跳回登入頁

我改成在過期前 60 秒先更新，並把時間來源抽成 \`clock\`，這樣測試才能控制時間：

\`\`\`typescript
import { clock } from './clock'

const REFRESH_MARGIN_MS = 60_000

export function needsRefresh(session: Session, now = clock.now()) {
  return session.expiresAt - now < REFRESH_MARGIN_MS
}
\`\`\``

const MOCK_COMMANDS: SlashCommand[] = [
  { name: 'fix-lint', description: '跑 lint 並修好錯誤' },
  { name: 'release-notes', description: '整理這一版的更新說明' },
]

const demoPlan = `登入一小時後被登出，是因為 \`needsRefresh()\` 要等 token 過期才更新

1. 在 \`src/auth/session.ts\` 改成過期前 60 秒就更新
2. 新增 \`src/auth/clock.ts\`，把時間來源抽出來，測試才能快轉時間
3. 在 \`tests/auth/session.test.ts\` 補兩個測試：快過期時更新、過期那一刻仍然登入
4. 跑 \`npm run test:auth\` 確認都通過`

const demoTodos: Todo[] = [
  { content: '找出被登出的原因', status: 'completed' },
  { content: '改成過期前 60 秒更新 token', status: 'completed' },
  { content: '把時間來源抽成 clock', status: 'completed' },
  { content: '補上快過期和過期那一刻的測試', status: 'in_progress' },
  { content: '跑 auth 測試確認都通過', status: 'pending' },
]

function mainSession(): SessionData {
  const t0 = now - 26 * MIN
  const running = params.has('running') || params.has('todos') || params.has('queue')
  const perm = params.get('perm')
  if (perm === 'plan') return planSession(t0)
  const items: TranscriptItem[] = [
    { kind: 'user', id: id(), text: '使用者登入大約一小時後常常被突然登出，幫我找出原因並修好，記得補上測試', at: t0 },
    {
      kind: 'reasoning',
      id: id(),
      text: '一小時剛好是 access token 的有效期限，問題多半出在判斷要不要更新 token 的地方，先讀 session.ts，再跑一次 auth 的測試看能不能重現',
      startedAt: t0 + 1000,
      endedAt: t0 + 13_000,
    },
    { kind: 'text', id: id(), text: '我先看看登入狀態是在哪裡更新的', streaming: false },
    { kind: 'tool', id: id(), callId: 'c1', name: 'read_file', target: 'src/auth/session.ts', status: 'done', startedAt: t0 + 14_000, endedAt: t0 + 14_100, info: { lines: 142 } },
    {
      kind: 'tool',
      id: id(),
      callId: 'c2',
      name: 'search_files',
      target: 'needsRefresh',
      status: 'done',
      startedAt: t0 + 15_000,
      endedAt: t0 + 15_200,
      info: { matches: 6 },
      output:
        'src/auth/session.ts:20: export function needsRefresh(session: Session) {\nsrc/auth/session.ts:25:   if (!needsRefresh(session)) return session\nsrc/api/client.ts:48:     if (needsRefresh(current)) {\nsrc/hooks/useSession.ts:12:   const stale = needsRefresh(session)',
    },
    {
      kind: 'tool',
      id: id(),
      callId: 'c3',
      name: 'run_command',
      target: 'npm run test:auth',
      status: 'error',
      startedAt: t0 + 16_000,
      endedAt: t0 + 18_400,
      info: { exitCode: 1 },
      output: ' FAIL  tests/auth/session.test.ts\n   ✕ refreshes within 60s of expiry (12 ms)\n   ✕ keeps the user signed in at expiry (4 ms)\n   ✓ reuses a fresh session (2 ms)\n\n Tests  2 failed, 1 passed (3)',
    },
    { kind: 'text', id: id(), text: answer, streaming: false },
    { kind: 'tool', id: id(), callId: 'c4', name: 'edit_file', target: 'src/auth/session.ts', status: perm === 'edit' ? 'waiting' : 'done', path: 'src/auth/session.ts', created: false, stats: { added: 8, removed: 3 } },
  ]
  if (perm !== 'edit') {
    items.push(
      { kind: 'tool', id: id(), callId: 'c5', name: 'write_file', target: 'src/auth/clock.ts', status: 'done', path: 'src/auth/clock.ts', created: true, stats: { added: 21, removed: 0 } },
      { kind: 'tool', id: id(), callId: 'c6', name: 'edit_file', target: 'tests/auth/session.test.ts', status: 'done', path: 'tests/auth/session.test.ts', created: false, stats: { added: 12, removed: 2 } },
    )
    if (perm === 'command') {
      items.push(
        { kind: 'text', id: id(), text: '測試需要 zod 來檢查 token 的格式，專案裡還沒裝', streaming: false },
        { kind: 'tool', id: id(), callId: 'c7', name: 'run_command', target: 'npm install zod', status: 'waiting' },
      )
    } else if (running) {
      items.push(
        { kind: 'tool', id: id(), callId: 'c7', name: 'run_command', target: 'npm run test:auth', status: 'running', startedAt: now - 2000 },
      )
    } else {
      items.push(
        { kind: 'tool', id: id(), callId: 'c7', name: 'run_command', target: 'npm run test:auth', status: 'done', startedAt: t0 + 40_000, endedAt: t0 + 42_100, info: { exitCode: 0 }, output: ' ✓ tests/auth/session.test.ts (4)\n\n Tests  4 passed (4)' },
        {
          kind: 'text',
          id: id(),
          text: '改好了，測試都過了\n\n- 過期前 60 秒就先更新 token，不會再出現空檔\n- 時間來源改成 `clock`，測試可以直接快轉時間\n- 補了「快過期時更新」和「過期那一刻仍然登入」兩個測試',
          streaming: false,
        },
      )
    }
  }
  return {
    id: 'demo-main',
    title: '修正登入後被登出的問題',
    workspace: DSH,
    createdAt: t0,
    updatedAt: now - 2 * MIN,
    model: 'deepseek-flash',
    effort: 'high',
    permissionMode: 'ask',
    status: perm ? 'waiting' : running ? 'running' : 'idle',
    items,
    usage: { promptTokens: 61_240, completionTokens: 3_180, cacheHitTokens: 40_960, contextTokens: 18_420 },
    ...(running && (params.has('todos') || params.has('queue')) ? { todos: demoTodos } : {}),
  }
}

function planSession(t0: number): SessionData {
  return {
    id: 'demo-main',
    title: '修正登入後被登出的問題',
    workspace: DSH,
    createdAt: t0,
    updatedAt: now - 2 * MIN,
    model: 'deepseek-flash',
    effort: 'high',
    permissionMode: 'plan',
    status: 'waiting',
    items: [
      { kind: 'user', id: id(), text: '使用者登入大約一小時後常常被突然登出，先幫我想好怎麼修，確認後再動手', at: t0 },
      { kind: 'reasoning', id: id(), text: '一小時剛好是 access token 的有效期限，先讀 session.ts', startedAt: t0 + 1000, endedAt: t0 + 9000 },
      { kind: 'text', id: id(), text: '我先看看登入狀態是在哪裡更新的', streaming: false },
      { kind: 'tool', id: id(), callId: 'c1', name: 'read_file', target: 'src/auth/session.ts', status: 'done', startedAt: t0 + 10_000, endedAt: t0 + 10_100, info: { lines: 142 } },
      { kind: 'tool', id: id(), callId: 'c2', name: 'search_files', target: 'needsRefresh', status: 'done', startedAt: t0 + 11_000, endedAt: t0 + 11_200, info: { matches: 6 } },
      { kind: 'tool', id: id(), callId: 'c3', name: 'read_file', target: 'tests/auth/session.test.ts', status: 'done', startedAt: t0 + 12_000, endedAt: t0 + 12_100, info: { lines: 38 } },
      { kind: 'tool', id: id(), callId: 'c4', name: 'exit_plan_mode', target: '計畫', status: 'waiting', output: demoPlan },
    ],
    usage: { promptTokens: 31_240, completionTokens: 1_180, cacheHitTokens: 20_960, contextTokens: 12_420 },
  }
}

function shortSession(sid: string, title: string, updatedAt: number, status: SessionMeta['status'] = 'idle', workspace = DSH): SessionData {
  return {
    id: sid,
    title,
    workspace,
    createdAt: updatedAt - 20 * MIN,
    updatedAt,
    model: 'deepseek-flash',
    effort: 'high',
    permissionMode: 'ask',
    status,
    items: [
      { kind: 'user', id: id(), text: title, at: updatedAt - 20 * MIN },
      { kind: 'text', id: id(), text: '好的，我先看一下相關的檔案', streaming: false },
    ],
    usage: { ...EMPTY_USAGE, promptTokens: 4200, completionTokens: 380, contextTokens: 4200 },
  }
}

const day = 24 * 60 * MIN
type MockSession = { data: SessionData; changes: FileChange[]; permission: PermissionRequest | null; queue: QueuedMessage[] }
const sessions = new Map<string, MockSession>()
function addSession(data: SessionData, changes: FileChange[] = [], permission: PermissionRequest | null = null) {
  sessions.set(data.id, { data, changes, permission, queue: [] })
}

const main = mainSession()
const mainPermission: PermissionRequest | null =
  params.get('perm') === 'edit'
    ? { id: 'p1', sessionId: 'demo-main', toolItemId: main.items[main.items.length - 1].id, kind: 'edit', path: 'src/auth/session.ts', created: false, stats: { added: 8, removed: 3 }, lines: sessionDiff }
    : params.get('perm') === 'command'
      ? { id: 'p2', sessionId: 'demo-main', toolItemId: main.items[main.items.length - 1].id, kind: 'command', command: 'npm install zod', cwd: DSH, prefix: 'npm install' }
      : params.get('perm') === 'plan'
        ? { id: 'p3', sessionId: 'demo-main', toolItemId: main.items[main.items.length - 1].id, kind: 'plan', plan: demoPlan }
        : null
addSession(main, params.get('perm') === 'edit' || params.get('perm') === 'plan' ? [] : mainChanges, mainPermission)
if (params.has('queue')) sessions.get('demo-main')!.queue.push({ id: 'q1', text: '測試過了之後順便更新 README 裡登入的說明' })
addSession(shortSession('s2', '把設定頁拆成小元件', now - 40 * MIN, 'idle'))
addSession(shortSession('s3', '更新 README 的安裝步驟', now - 90 * MIN))
addSession(shortSession('s4', '加上深色模式', now - day - 3 * 60 * MIN))
addSession(shortSession('s5', '查打包後的白畫面', now - day - 6 * 60 * MIN))
addSession(shortSession('s6', '改用 pnpm 管理套件', now - 3 * day))
addSession(shortSession('s7', '設定 ESLint 和 Prettier', now - 4 * day))
addSession(shortSession('s8', '整理 API 錯誤訊息的寫法', now - 12 * day))
const TRACKER = `${HOME}/Projects/oyama-tracker`
addSession(shortSession('t1', '圖表的日期軸對不齊', now - 3 * 60 * MIN, 'idle', TRACKER))
addSession(shortSession('t2', '匯出 CSV 時亂碼', now - 2 * day, 'idle', TRACKER))
addSession(shortSession('n1', '整理讀書筆記的目錄', now - 5 * day, 'idle', `${HOME}/Documents/notes`))

const metaOf = ({ items: _i, usage: _u, ...meta }: SessionData): SessionMeta => meta
const snapshot = (sid: string) => {
  const s = sessions.get(sid)
  return s ? structuredClone({ session: s.data, changes: s.changes, permission: s.permission, queue: s.queue }) : null
}

// ── a scripted agent for new messages ───────────────────────────

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('stopped', 'AbortError'))
    })
  })

const running = new Map<string, AbortController>()
const waiting = new Map<string, (decision: PermissionDecision) => void>()

function setStatus(data: SessionData, status: SessionData['status']) {
  data.status = status
  data.updatedAt = Date.now()
  emit({ type: 'meta', meta: metaOf(data) })
}

function put(data: SessionData, item: TranscriptItem) {
  const index = data.items.findIndex((i) => i.id === item.id)
  if (index === -1) data.items.push(item)
  else data.items[index] = item
  emit({ type: 'item', sessionId: data.id, item })
}

async function stream(data: SessionData, item: Extract<TranscriptItem, { kind: 'text' | 'reasoning' }>, text: string, signal: AbortSignal) {
  for (let i = 0; i < text.length; i += 3) {
    await sleep(40, signal)
    item.text = text.slice(0, i + 3)
    put(data, { ...item })
  }
}

function setTodos(data: SessionData, todos: Todo[]) {
  data.todos = todos
  emit({ type: 'todos', sessionId: data.id, todos })
}

const tool = (name: string, target: string, extra: Partial<Extract<TranscriptItem, { kind: 'tool' }>> = {}): Extract<TranscriptItem, { kind: 'tool' }> => ({
  kind: 'tool',
  id: id(),
  callId: id(),
  name,
  target,
  status: 'running',
  startedAt: Date.now(),
  ...extra,
})

function addUser(data: SessionData, message: { id?: string; text: string; refs?: FileRef[] }) {
  const command = /^\/([\w.-]+)/.exec(message.text)?.[1]
  put(data, { kind: 'user', id: message.id ?? id(), text: message.text, at: Date.now(), ...(message.refs?.length ? { refs: message.refs } : {}), ...(command ? { command } : {}) })
}

/** Sends in what was typed while the demo agent worked. */
function drain(entry: MockSession): boolean {
  if (!entry.queue.length) return false
  const queued = entry.queue
  entry.queue = []
  emit({ type: 'queue', sessionId: entry.data.id, queue: [] })
  for (const message of queued) addUser(entry.data, message)
  return true
}

async function ask(entry: MockSession, request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
  const sid = entry.data.id
  entry.permission = request
  setStatus(entry.data, 'waiting')
  emit({ type: 'permission', sessionId: sid, request })
  const decision = await new Promise<PermissionDecision>((resolve) => {
    waiting.set(sid, resolve)
    signal.addEventListener('abort', () => resolve({ type: 'deny' }))
  })
  waiting.delete(sid)
  entry.permission = null
  emit({ type: 'permission', sessionId: sid, request: null })
  setStatus(entry.data, 'running')
  if (signal.aborted) throw new DOMException('stopped', 'AbortError')
  return decision
}

async function say(data: SessionData, text: string, signal: AbortSignal) {
  const item: Extract<TranscriptItem, { kind: 'text' }> = { kind: 'text', id: id(), text: '', streaming: true }
  await stream(data, item, text, signal)
  put(data, { ...item, streaming: false })
}

async function runAgent(sid: string, text: string, refs: FileRef[] = []) {
  const entry = sessions.get(sid)!
  const data = entry.data
  const controller = new AbortController()
  const { signal } = controller
  running.set(sid, controller)
  addUser(data, { text, refs })
  setStatus(data, 'running')
  try {
    await sleep(700, signal)
    if (data.effort !== 'none') {
      const reasoning: Extract<TranscriptItem, { kind: 'reasoning' }> = { kind: 'reasoning', id: id(), text: '', startedAt: Date.now() }
      await stream(data, reasoning, '先看專案結構，找到 README，再決定要補哪些段落', signal)
      put(data, { ...reasoning, endedAt: Date.now() })
    }
    const steps: Todo[] = [
      { content: '看專案的結構', status: 'in_progress' },
      { content: '改寫 README 的開頭', status: 'pending' },
      { content: '確認改動沒問題', status: 'pending' },
    ]
    const todoTool = (todos: Todo[]) => {
      const done = todos.filter((t) => t.status === 'completed').length
      put(data, tool('todo_write', `${done}/${todos.length}`, { status: 'done', endedAt: Date.now() }))
      setTodos(data, todos.map((t) => ({ ...t })))
    }
    todoTool(steps)
    await say(data, '我先看一下專案的結構', signal)

    const list = tool('list_dir', '.')
    put(data, list)
    await sleep(900, signal)
    put(data, { ...list, status: 'done', endedAt: Date.now(), info: { files: 12 }, output: 'README.md\npackage.json\nsrc/\ntests/\nvite.config.ts' })
    steps[0].status = 'completed'
    steps[1].status = 'in_progress'
    todoTool(steps)
    if (drain(entry)) {
      await sleep(400, signal)
      await say(data, '收到，我會一起處理', signal)
    }

    const lines: DiffLine[] = [hunk('@@ -1,3 +1,5 @@'), ctx(1, 1, '# DeepSeek Harness'), del(2, 'TODO'), add(2, ''), add(3, '用 DeepSeek API 驅動的寫程式 Agent'), add(4, '')]

    if (data.permissionMode === 'plan') {
      const planText = '1. 把 README 開頭的 TODO 換成一句話說明這個專案\n2. 補上安裝和啟動的步驟\n3. 看一次預覽確認排版'
      const plan = tool('exit_plan_mode', '計畫', { status: 'waiting', output: planText })
      put(data, plan)
      const decision = await ask(entry, { id: id(), sessionId: sid, toolItemId: plan.id, kind: 'plan', plan: planText }, signal)
      if (decision.type === 'deny') {
        put(data, { ...plan, status: 'denied', endedAt: Date.now() })
        await sleep(400, signal)
        await say(data, decision.feedback ? `好，我照「${decision.feedback}」改一下計畫` : '好，計畫先放著，想改哪裡跟我說', signal)
        return
      }
      put(data, { ...plan, status: 'done', endedAt: Date.now() })
      Object.assign(data, { permissionMode: decision.type === 'allow' && decision.mode ? decision.mode : 'acceptEdits' })
      emit({ type: 'meta', meta: metaOf(data) })
    }

    const edit = tool('edit_file', 'README.md', { status: 'waiting', path: 'README.md', created: false, stats: { added: 3, removed: 1 } })
    put(data, edit)
    let decision: PermissionDecision = { type: 'allow' }
    if (data.permissionMode === 'ask') {
      decision = await ask(entry, { id: id(), sessionId: sid, toolItemId: edit.id, kind: 'edit', path: 'README.md', created: false, stats: edit.stats, lines }, signal)
    }
    if (decision.type === 'deny') {
      put(data, { ...edit, status: 'denied', endedAt: Date.now() })
      await sleep(500, signal)
      await say(data, decision.feedback ? `好，那我改成這樣做：${decision.feedback}` : '好，這個檔案我先不改，想換個做法可以直接告訴我', signal)
    } else {
      put(data, { ...edit, status: 'running', startedAt: Date.now() })
      await sleep(300, signal)
      put(data, { ...edit, status: 'done', endedAt: Date.now() })
      entry.changes = [{ path: 'README.md', status: 'modified', stats: { added: 3, removed: 1 }, lines }, ...entry.changes.filter((c) => c.path !== 'README.md')]
      emit({ type: 'changes', sessionId: sid, changes: entry.changes })
      steps[1].status = 'completed'
      steps[2].status = 'in_progress'
      todoTool(steps)
      await sleep(900, signal)
      steps[2].status = 'completed'
      todoTool(steps)
      await say(data, '改好了，README 開頭現在會說明這個專案是做什麼的', signal)
    }
    data.usage = { promptTokens: data.usage.promptTokens + 9800, completionTokens: data.usage.completionTokens + 420, cacheHitTokens: 0, contextTokens: data.usage.contextTokens + 3400 }
    emit({ type: 'usage', sessionId: sid, usage: data.usage })
    if (drain(entry)) {
      await sleep(500, signal)
      await say(data, '剛剛補充的我也看了，目前這樣就可以', signal)
    }
  } catch {
    for (const item of data.items) {
      if (item.kind === 'tool' && (item.status === 'running' || item.status === 'waiting')) put(data, { ...item, status: 'stopped' })
      if (item.kind === 'text' && item.streaming) put(data, { ...item, streaming: false })
    }
    put(data, { kind: 'notice', id: id(), code: 'stopped' })
  } finally {
    running.delete(sid)
    setStatus(data, 'idle')
  }
}

// ── the API ─────────────────────────────────────────────────────

const later = <T>(value: T, ms = 60) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

export function createMockApi(): DshApi {
  return {
    getInitialState: () =>
      later({
        settings,
        hasApiKey: apiKey !== null,
        app: { platform: params.get('platform') ?? 'darwin', version: '0.1.0', keyEncryption: true, home: HOME },
        workspace,
      }),
    settings: {
      async update(patch) {
        settings = { ...settings, ...patch }
        emit({ type: 'settings', settings, hasApiKey: apiKey !== null })
        return settings
      },
      async setApiKey(key) {
        apiKey = key
        emit({ type: 'settings', settings, hasApiKey: true })
      },
      async clearApiKey() {
        apiKey = null
        emit({ type: 'settings', settings, hasApiKey: false })
      },
      revealApiKey: async () => apiKey,
      testConnection: () => later(apiKey ? { ok: true, latencyMs: 182 } : { ok: false, error: 'no-key' as const }, 700),
    },
    workspace: {
      async pick() {
        return this.open(`${HOME}/Projects/oyama-tracker`)
      },
      async open(path) {
        const info = workspaces[path] ?? null
        if (!info) return null
        workspace = info
        settings = {
          ...settings,
          lastWorkspace: path,
          recentWorkspaces: [path, ...settings.recentWorkspaces.filter((p) => p !== path)],
          projects: settings.projects.includes(path) ? settings.projects : [path, ...settings.projects],
        }
        emit({ type: 'settings', settings, hasApiKey: apiKey !== null })
        emit({ type: 'workspace', workspace: info })
        return info
      },
      files: async () => ({ files: MOCK_PATHS, truncated: false }),
      commands: async () => MOCK_COMMANDS,
      read: async (file) =>
        later(
          MOCK_FILES[file] !== undefined
            ? { ok: true as const, text: MOCK_FILES[file] }
            : MOCK_PATHS.includes(file)
              ? { ok: true as const, text: `// ${file}\n\nexport {}\n` }
              : { ok: false as const, error: `${file} does not exist.` },
          120,
        ),
    },
    sessions: {
      list: async (path) => [...sessions.values()].filter((s) => s.data.workspace === path).map((s) => metaOf(s.data)),
      load: async (sid) => snapshot(sid),
      async remove(sid) {
        running.get(sid)?.abort()
        sessions.delete(sid)
      },
    },
    agent: {
      async start(path, text, opts, refs) {
        const data: SessionData = {
          id: opts.id,
          title: text.split('\n')[0].slice(0, 40),
          workspace: path,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model: opts.model,
          effort: opts.effort,
          permissionMode: opts.permissionMode,
          status: 'idle',
          items: [],
          usage: { ...EMPTY_USAGE },
        }
        addSession(data)
        void runAgent(data.id, text, refs)
        return metaOf(data)
      },
      async send(sid, text, refs) {
        const entry = sessions.get(sid)
        if (!entry) return
        if (running.has(sid) || entry.data.status !== 'idle') {
          entry.queue.push({ id: id(), text, ...(refs?.length ? { refs } : {}) })
          emit({ type: 'queue', sessionId: sid, queue: structuredClone(entry.queue) })
          return
        }
        void runAgent(sid, text, refs)
      },
      async unqueue(sid, messageId) {
        const entry = sessions.get(sid)
        if (!entry) return []
        const taken = entry.queue.filter((m) => !messageId || m.id === messageId)
        entry.queue = entry.queue.filter((m) => messageId && m.id !== messageId)
        emit({ type: 'queue', sessionId: sid, queue: structuredClone(entry.queue) })
        return taken
      },
      async rewind(sid, itemId, mode) {
        const entry = sessions.get(sid)
        const index = entry?.data.items.findIndex((i) => i.id === itemId) ?? -1
        const item = entry?.data.items[index]
        if (!entry || !item || item.kind !== 'user') return { ok: false as const, error: 'not-found' }
        if (mode !== 'code') {
          entry.data.items = entry.data.items.slice(0, index)
          entry.data.todos = undefined
        }
        let restored = 0
        if (mode !== 'conversation') {
          restored = entry.changes.length
          entry.changes = []
          emit({ type: 'changes', sessionId: sid, changes: [] })
        }
        return { ok: true as const, text: item.text, ...(item.refs ? { refs: item.refs } : {}), restored }
      },
      async stop(sid) {
        running.get(sid)?.abort()
      },
      async retry() {},
      async compact() {},
      async respond(sid, _requestId, decision) {
        const resolve = waiting.get(sid)
        if (resolve) resolve(decision)
        else {
          // The demo prompts that start from the URL have no script behind them.
          const entry = sessions.get(sid)
          if (!entry?.permission) return
          const toolId = entry.permission.toolItemId
          entry.permission = null
          emit({ type: 'permission', sessionId: sid, request: null })
          const tool = entry.data.items.find((i) => i.id === toolId)
          if (tool?.kind === 'tool') put(entry.data, { ...tool, status: decision.type === 'deny' ? 'denied' : 'done' })
          if (tool?.kind === 'tool' && tool.name === 'exit_plan_mode' && decision.type !== 'deny') {
            entry.data.permissionMode = decision.type === 'allow' && decision.mode ? decision.mode : 'acceptEdits'
            emit({ type: 'meta', meta: metaOf(entry.data) })
          }
          setStatus(entry.data, 'idle')
        }
      },
      async configure(sid, opts) {
        const entry = sessions.get(sid)
        if (!entry) return null
        Object.assign(entry.data, opts)
        emit({ type: 'meta', meta: metaOf(entry.data) })
        return metaOf(entry.data)
      },
    },
    changes: {
      async revertAll(sid) {
        const entry = sessions.get(sid)
        if (!entry) return
        entry.changes = []
        emit({ type: 'changes', sessionId: sid, changes: [] })
      },
      async commit(sid) {
        await later(null, 500)
        const entry = sessions.get(sid)
        if (entry) {
          entry.changes = []
          emit({ type: 'changes', sessionId: sid, changes: [] })
        }
        return { ok: true }
      },
    },
    openExternal: async (url) => void window.open(url, '_blank', 'noopener'),
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
