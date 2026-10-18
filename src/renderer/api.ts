// The bridge to the main process. In Electron the preload script provides it; in a plain browser
// (npm run dev:web) main.tsx installs the demo from mock.ts instead.

import type { DshApi } from '../shared/types'

declare global {
  interface Window {
    dsh?: DshApi
  }
}

export let api: DshApi = window.dsh as DshApi

export function installApi(next: DshApi) {
  api = next
}
