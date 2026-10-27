import { useEffect, useRef, useState } from 'react'
import { ChatPanel } from './components/Chat'
import { CommandPalette } from './components/CommandPalette'
import { EditorArea } from './components/EditorArea'
import { Resizer } from './components/Resizer'
import { SettingsSheet } from './components/SettingsSheet'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TerminalPanel } from './components/TerminalPanel'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { Welcome } from './components/Welcome'
import { cx } from './components/ui'
import { useSettings } from './state/settings'
import { useWorkspace } from './state/workspace'

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function App() {
  const info = useWorkspace((s) => s.info)
  const layout = useSettings((s) => s.settings.layout)
  const { preview, update } = useSettings.getState()
  const start = useRef({ sidebar: 0, chat: 0, terminal: 0 })
  const [terminalMounted, setTerminalMounted] = useState(layout.terminalVisible)

  // Shells live as long as the folder is open, even while the panel is hidden.
  useEffect(() => {
    if (!info) setTerminalMounted(false)
    else if (layout.terminalVisible) setTerminalMounted(true)
  }, [info, layout.terminalVisible])

  const remember = () => {
    const l = useSettings.getState().settings.layout
    start.current = { sidebar: l.sidebarWidth, chat: l.chatWidth, terminal: l.terminalHeight }
  }
  const commit = () => {
    const l = useSettings.getState().settings.layout
    void update({ layout: { sidebarWidth: l.sidebarWidth, chatWidth: l.chatWidth, terminalHeight: l.terminalHeight } })
    remember()
  }

  return (
    <div className="app" onPointerDownCapture={remember}>
      <TitleBar />
      {info ? (
        <>
          <div className={cx('body', !layout.sidebarVisible && 'no-sidebar')}>
            {layout.sidebarVisible && (
              <>
                <div className="sidebar-slot" style={{ width: layout.sidebarWidth }}>
                  <Sidebar />
                </div>
                <Resizer axis="x" onDrag={(d) => preview({ layout: { sidebarWidth: clamp(start.current.sidebar + d, 180, 520) } })} onEnd={commit} />
              </>
            )}
            <div className="workbench">
              <EditorArea />
              {terminalMounted && (
                <>
                  {layout.terminalVisible && (
                    <Resizer axis="y" onDrag={(d) => preview({ layout: { terminalHeight: clamp(start.current.terminal - d, 120, window.innerHeight - 240) } })} onEnd={commit} />
                  )}
                  <div className={cx('terminal-slot', !layout.terminalVisible && 'is-hidden')} style={{ height: layout.terminalHeight }}>
                    <TerminalPanel />
                  </div>
                </>
              )}
            </div>
            {layout.chatVisible && (
              <>
                <Resizer axis="x" onDrag={(d) => preview({ layout: { chatWidth: clamp(start.current.chat - d, 300, 760) } })} onEnd={commit} />
                <div className="chat-slot" style={{ width: layout.chatWidth }}>
                  <ChatPanel />
                </div>
              </>
            )}
          </div>
          <StatusBar />
        </>
      ) : (
        <Welcome />
      )}
      <CommandPalette />
      <SettingsSheet />
      <Toasts />
    </div>
  )
}
