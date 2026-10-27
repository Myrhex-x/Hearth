import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './styles/tokens.css'
import './styles/app.css'
import { api } from './api'
import { App } from './App'
import { runCommand } from './lib/commands'
import { installShortcuts } from './lib/shortcuts'
import { syncFromDisk } from './state/editor'
import { startModelPolling, useModels } from './state/models'
import { handleCloseRequest, openFolder, restoreLastFolder, startPersistence } from './state/session'
import { initSettings, settingsNow } from './state/settings'
import { useWorkspace } from './state/workspace'
import { useGit } from './state/git'
import { startMeaningUpdates } from './state/meaning'

// Monaco cancels in-flight work (completions, hovers) by rejecting with "Canceled".
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { name?: string; message?: string } | undefined
  if (reason?.name === 'Canceled' || reason?.message === 'Canceled') e.preventDefault()
})

async function boot(): Promise<void> {
  document.documentElement.dataset.platform = api.platform
  // Monaco and xterm measure character widths once; the bundled mono font must be ready first.
  await Promise.race([
    Promise.all([document.fonts.load("13px 'JetBrains Mono Variable'"), document.fonts.load("600 13px 'JetBrains Mono Variable'")]).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ])
  await initSettings()

  installShortcuts()
  startPersistence()
  startModelPolling()
  startMeaningUpdates()
  void useModels.getState().refresh()

  api.app.onMenuCommand((command) => runCommand(command))
  api.app.onCloseRequested(() => void handleCloseRequest())
  api.workspace.onChanged((paths) => {
    useWorkspace.getState().onFsChanged(paths)
    void syncFromDisk(paths)
    useGit.getState().scheduleRefresh()
  })
  window.addEventListener('focus', () => useGit.getState().scheduleRefresh(50))
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )

  // A reload keeps the folder open in the main process; otherwise the first
  // window reopens the last project.
  const current = await api.workspace.current()
  if (current) await openFolder(current.root)
  else if (new URLSearchParams(location.search).has('first')) await restoreLastFolder(settingsNow().lastWorkspace)
  api.app.rendererReady()
}

void boot()
