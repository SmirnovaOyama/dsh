// Electron entry point: the window, the IPC handlers and app lifecycle.

import { BrowserWindow, app, dialog, ipcMain, nativeTheme, protocol, safeStorage, session, shell } from 'electron'
import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Channels, EVENT_CHANNEL } from '../shared/ipc'
import type { AgentEvent, ConfigureOptions, FileRead, InitialState, PermissionDecision, SaveResult, Settings, StartOptions } from '../shared/types'
import { saveToFolder, safeFileName, writeTempPage } from './artifactFiles'
import { PREVIEW_SCHEME, PreviewPages, withPolicy } from './artifactPreview'
import { PreviewGate, gateProxy } from './previewNetwork'
import { Controller, readWorkspace } from './controller'
import { DeepSeekError, checkConnection } from './deepseek'
import { cleanRefs } from './refs'
import { listWorkspaceFiles, readTextFile } from './tools/files'
import { resolveInWorkspace } from './tools/paths'
import { SessionStore, SettingsStore, type KeyCipher } from './store'

const devServerUrl = process.env.DSH_DEV_SERVER_URL

let window: BrowserWindow | null = null

const cipher: KeyCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
}

const settingsStore = new SettingsStore(app.getPath('userData'), cipher)
const sessionStore = new SessionStore(app.getPath('userData'))

function emit(event: AgentEvent) {
  if (window && !window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event)
}

const controller = new Controller({ settings: settingsStore, sessions: sessionStore, emit })
const previews = new PreviewPages()
// The way out for preview pages (see previewNetwork); previews run only once the session goes through it.
const gate = new PreviewGate((url) => session.fromPartition('dsh-system-proxy').resolveProxy(url))
let fenced = false

// The scheme artifact previews load from; registered before the app is ready, as Electron requires.
protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true } }])

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function backgroundFor(theme: Settings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  // The page colour, so the window never flashes a different shade before the first paint.
  return dark ? '#252525' : '#fafafa'
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: backgroundFor(settingsStore.get().theme),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  window.once('ready-to-show', () => window?.show())

  // WebRTC is outside a preview's content policy, so it may only go through the proxy (see previewNetwork).
  window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')

  // Links in answers open in the person's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  // A preview stays on its own page: links in it are offered to the person instead (see the artifact bridge).
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !event.url.startsWith(`${PREVIEW_SCHEME}:`)) event.preventDefault()
  })

  if (devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))

  window.on('closed', () => {
    window = null
  })
}

/** A folder that was moved or deleted fails to open, rather than opening as a place where nothing works. */
async function readFolder(dir: string) {
  const isFolder = await stat(dir).then((s) => s.isDirectory(), () => false)
  if (!isFolder) throw new Error(`${dir} is not a folder`)
  return readWorkspace(dir)
}

async function openWorkspace(dir: string) {
  const info = await readFolder(dir)
  const settings = settingsStore.get()
  const recent = [dir, ...settings.recentWorkspaces.filter((p) => p !== dir)].slice(0, 8)
  const next = await settingsStore.update({ lastWorkspace: dir, recentWorkspaces: recent })
  emit({ type: 'settings', settings: next, hasApiKey: settingsStore.hasApiKey() })
  emit({ type: 'workspace', workspace: info })
  return info
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: keyof typeof Channels, fn: (...args: any[]) => unknown) {
  ipcMain.handle(Channels[channel], (_event, ...args) => fn(...args))
}

function registerIpc() {
  handle('initialState', async (): Promise<InitialState> => {
    const settings = settingsStore.get()
    let workspace = null
    if (settings.lastWorkspace) {
      try {
        workspace = await readFolder(settings.lastWorkspace)
      } catch {
        workspace = null
      }
    }
    return {
      settings,
      hasApiKey: settingsStore.hasApiKey(),
      app: {
        platform: process.platform,
        version: app.getVersion(),
        keyEncryption: safeStorage.isEncryptionAvailable(),
        home: app.getPath('home'),
      },
      workspace,
    }
  })

  handle('settingsUpdate', async (patch: Partial<Settings>) => {
    const next = await settingsStore.update(patch)
    if (window && patch.theme) window.setBackgroundColor(backgroundFor(next.theme))
    emit({ type: 'settings', settings: next, hasApiKey: settingsStore.hasApiKey() })
    return next
  })
  handle('settingsSetKey', async (key: string) => {
    await settingsStore.setApiKey(key)
    emit({ type: 'settings', settings: settingsStore.get(), hasApiKey: settingsStore.hasApiKey() })
  })
  handle('settingsClearKey', async () => {
    await settingsStore.clearApiKey()
    emit({ type: 'settings', settings: settingsStore.get(), hasApiKey: false })
  })
  handle('settingsRevealKey', () => settingsStore.apiKey())
  handle('settingsTest', async () => {
    const key = settingsStore.apiKey()
    if (!key) return { ok: false, error: 'no-key' }
    try {
      const latencyMs = await checkConnection(settingsStore.get().baseUrl, key)
      return { ok: true, latencyMs }
    } catch (error) {
      const code = error instanceof DeepSeekError && error.code !== 'aborted' ? error.code : 'unknown'
      return { ok: false, error: code }
    }
  })

  handle('workspacePick', async () => {
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return openWorkspace(result.filePaths[0])
  })
  handle('workspaceOpen', async (dir: string) => {
    try {
      return await openWorkspace(dir)
    } catch {
      return null
    }
  })

  // Browsing is limited to the folder that is open now, whatever path the renderer asks for.
  handle('workspaceFiles', async () => {
    const dir = settingsStore.get().lastWorkspace
    if (!dir) return { files: [], truncated: false }
    return listWorkspaceFiles(dir, await resolveInWorkspace(dir, '.'))
  })
  handle('workspaceRead', async (file: string): Promise<FileRead> => {
    const dir = settingsStore.get().lastWorkspace
    if (!dir) return { ok: false, error: 'No folder is open.' }
    try {
      return { ok: true, text: await readTextFile(await resolveInWorkspace(dir, file)) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  handle('sessionsList', (workspace: string) => sessionStore.list(workspace))
  handle('sessionsLoad', (id: string) => controller.snapshot(id))
  handle('sessionsRemove', (id: string) => controller.remove(id))

  handle('agentStart', (workspace: string, text: string, opts: StartOptions, refs?: unknown) =>
    controller.start(workspace, text, opts, cleanRefs(refs)),
  )
  handle('agentSend', (id: string, text: string, refs?: unknown) => controller.send(id, text, cleanRefs(refs)))
  handle('agentStop', (id: string) => controller.stop(id))
  handle('agentRetry', (id: string) => controller.retry(id))
  handle('agentCompact', (id: string, focus?: string) => controller.compact(id, focus))
  handle('agentRespond', (id: string, requestId: string, decision: PermissionDecision) => controller.respond(id, requestId, decision))
  handle('agentConfigure', (id: string, opts: ConfigureOptions) => controller.configure(id, opts))

  handle('changesRevertAll', (id: string) => controller.revertAll(id))
  handle('changesCommit', (id: string, message: string) => controller.commit(id, message))

  // If the session could not be fenced in, the viewer shows this error instead of the page.
  handle('artifactsPreview', (html: string) => {
    if (!fenced) throw new Error('The preview network is not ready.')
    return previews.add(html)
  })
  handle('artifactsSave', async (name: string, content: string): Promise<SaveResult | null> => {
    const options: Electron.SaveDialogOptions = { defaultPath: safeFileName(name) }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    try {
      await writeFile(result.filePath, String(content), 'utf8')
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })
  // Only ever the open folder's top level, under a name that is not taken.
  handle('artifactsSaveToProject', (name: string, content: string) => saveToFolder(settingsStore.get().lastWorkspace, name, content))
  // The page keeps the preview's policy in the browser too, so opening it there gives it no more reach.
  handle('artifactsOpenInBrowser', async (name: string, html: string): Promise<SaveResult> => {
    try {
      const file = await writeTempPage(app.getPath('temp'), name, withPolicy(String(html ?? '')))
      const error = await shell.openPath(file)
      return error ? { ok: false, error } : { ok: true, path: file }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })
  handle('artifactsLibrary', () => controller.artifacts())

  handle('openExternal', async (url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  })
}

// One window writes the conversation files; a second launch focuses it instead.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

// The dev script and the terminal stop the app with a signal; quit normally so conversations are saved.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())

app.whenReady().then(async () => {
  protocol.handle(PREVIEW_SCHEME, (request) => previews.respond(request.url))
  // Nothing in the app downloads files; a page in a preview must not open save dialogs either.
  session.defaultSession.on('will-download', (event) => event.preventDefault())
  // The gate asks an in-memory session the app never changes, so it always gets the system's own routes.
  // If the gate cannot start, the session still goes nowhere but the dev server.
  const port = await gate.listen().catch(() => null)
  await session.defaultSession
    .setProxy(gateProxy(port, devServerUrl ? new URL(devServerUrl).hostname : undefined))
    .then(() => (fenced = true), () => undefined)
  await Promise.all([settingsStore.load(), sessionStore.load()])
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let flushed = false
app.on('before-quit', (event) => {
  if (flushed) return
  // Write unsaved conversations before the process exits.
  event.preventDefault()
  controller.stopAll()
  void sessionStore.flush().finally(() => {
    flushed = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
