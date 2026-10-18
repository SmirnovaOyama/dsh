import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installApi } from './api'
import { App } from './App'
import { restorePaneWidths } from './components/Resizer'
import { actions } from './store'
import './styles/tokens.css'
import './styles/ods.css'
import './styles/app.css'

async function boot() {
  if (!window.dsh) {
    // Outside Electron (npm run dev:web) the app runs against a demo with made-up data.
    const { createMockApi } = await import('./mock')
    installApi(createMockApi())
  }
  restorePaneWidths()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  await actions.init()
}

void boot()
