// Starts the Vite dev server, rebuilds main and preload on change, and restarts Electron.
import { spawn, fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const server = await createServer({ configFile: 'vite.config.ts' })
await server.listen()
const url = server.resolvedUrls.local[0]

let electron = null
let restartTimer = null

function startElectron() {
  if (electron) {
    electron.removeAllListeners('exit')
    electron.kill()
  }
  electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, DSH_DEV_SERVER_URL: url },
  })
  electron.on('exit', () => {
    builder.kill()
    server.close()
    process.exit(0)
  })
}

const builder = fork('scripts/build-main.mjs', ['--watch'], { stdio: 'inherit' })
builder.on('message', () => {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(startElectron, 150)
})
