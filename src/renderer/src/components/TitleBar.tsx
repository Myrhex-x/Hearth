import { ChevronDown, GitBranch, PanelLeft, PanelRight, Search, SquareTerminal } from 'lucide-react'
import { api, isMac, isStore } from '../api'
import { shortcutLabel } from '../lib/keys'
import { closeFolder, openFolder } from '../state/session'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { useWorkspace } from '../state/workspace'
import { HearthIndicator } from './Hearth'
import { IconButton, cx } from './ui'

async function projectMenu(): Promise<void> {
  const recent = (await api.workspace.recent()).filter((r) => r.root !== useWorkspace.getState().info?.root).slice(0, 8)
  const choice = await api.app.contextMenu([
    { id: 'open', label: 'Open Folder…', accelerator: isMac ? 'Cmd+O' : 'Ctrl+O' },
    { id: 'window', label: 'New Window', accelerator: isMac ? 'Cmd+Shift+N' : 'Ctrl+Shift+N' },
    ...(recent.length ? [{ type: 'separator' as const }, ...recent.map((r, i) => ({ id: `recent:${i}`, label: r.name }))] : []),
    ...(useWorkspace.getState().info ? [{ type: 'separator' as const }, { id: 'reveal', label: isMac ? 'Reveal in Finder' : 'Show in File Explorer' }, { id: 'close', label: 'Close Folder' }] : [])
  ])
  if (!choice) return
  if (choice === 'open') void openFolder()
  else if (choice === 'window') api.app.newWindow()
  else if (choice === 'close') void closeFolder()
  else if (choice === 'reveal') api.app.revealPath('')
  else if (choice.startsWith('recent:')) void openFolder(recent[Number(choice.slice(7))].root)
}

export function TitleBar() {
  const info = useWorkspace((s) => s.info)
  const branch = useWorkspace((s) => s.branch)
  const layout = useSettings((s) => s.settings.layout)
  const update = useSettings((s) => s.update)
  const openPalette = useUi((s) => s.openPalette)

  const toggle = (key: 'sidebarVisible' | 'chatVisible' | 'terminalVisible') => void update({ layout: { [key]: !layout[key] } })

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        {info && (
          <IconButton label="Toggle sidebar" shortcut="mod+b" active={layout.sidebarVisible} onClick={() => toggle('sidebarVisible')}>
            <PanelLeft size={16} strokeWidth={1.7} />
          </IconButton>
        )}
        <button className="project-pill" onClick={() => void projectMenu()}>
          <span className="project-name">{info ? info.name : 'Hearth'}</span>
          {branch && (
            <span className="project-branch">
              <GitBranch size={12} strokeWidth={1.8} />
              {branch}
            </span>
          )}
          <ChevronDown size={12} strokeWidth={2} className="project-chevron" />
        </button>
      </div>

      <div className="titlebar-center">
        {info && (
          <button className="command-field" onClick={() => openPalette('files')}>
            <Search size={13} strokeWidth={2} />
            <span>Go to file or run a command</span>
            <kbd className="kbd">{shortcutLabel('mod+p')}</kbd>
          </button>
        )}
      </div>

      <div className="titlebar-right">
        <HearthIndicator />
        {info && (
          <>
            {!isStore && (
              <IconButton label="Toggle terminal" shortcut="ctrl+`" active={layout.terminalVisible} onClick={() => toggle('terminalVisible')}>
                <SquareTerminal size={16} strokeWidth={1.7} />
              </IconButton>
            )}
            <IconButton label="Toggle chat" shortcut="mod+alt+b" active={layout.chatVisible} onClick={() => toggle('chatVisible')} className={cx(!layout.chatVisible && 'dim')}>
              <PanelRight size={16} strokeWidth={1.7} />
            </IconButton>
          </>
        )}
      </div>
    </header>
  )
}
