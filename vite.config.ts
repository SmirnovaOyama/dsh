import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The packaged app only loads its own files. The dev server needs inline scripts for hot reload,
// so the policy is added to the built page only.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy: Plugin = {
  name: 'dsh-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), contentSecurityPolicy],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5317,
    strictPort: true,
  },
})
