// Bundles the Electron main and preload processes. The renderer is built by Vite.
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
}

const targets = [
  { ...shared, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs' },
  { ...shared, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs' },
]

if (watch) {
  for (const options of targets) {
    const ctx = await context({ ...options, plugins: [notify(options.outfile)] })
    await ctx.watch()
  }
} else {
  await Promise.all(targets.map((options) => build(options)))
}

function notify(outfile) {
  return {
    name: 'notify',
    setup(b) {
      b.onEnd((result) => {
        if (result.errors.length === 0 && process.send) process.send({ built: outfile })
      })
    },
  }
}
