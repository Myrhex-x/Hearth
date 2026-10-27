import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, isMac, isWin } from '../api'
import { getAppInfo } from '../agent/prompt'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { IconButton, cx } from './ui'

interface Session {
  key: string
  id: string | null
  title: string
  error?: string
  exited?: boolean
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function xtermTheme(dark: boolean) {
  return {
    background: cssVar('--card'),
    foreground: cssVar('--text'),
    cursor: cssVar('--ember'),
    cursorAccent: cssVar('--card'),
    selectionBackground: dark ? 'rgba(240,137,74,0.28)' : 'rgba(216,100,42,0.2)',
    black: dark ? '#3a3530' : '#2a241f',
    red: dark ? '#ee8b7e' : '#c2463a',
    green: dark ? '#8cc79b' : '#3b8a55',
    yellow: dark ? '#e5b866' : '#a86f12',
    blue: dark ? '#88b8e4' : '#3a74ad',
    magenta: dark ? '#d7a6e0' : '#8a4ea0',
    cyan: dark ? '#7fc4c4' : '#1f7a7a',
    white: dark ? '#d9d0c7' : '#6f665d',
    brightBlack: dark ? '#736b61' : '#9d948a',
    brightRed: dark ? '#ffa99d' : '#d8574a',
    brightGreen: dark ? '#a9dcb5' : '#4ea36a',
    brightYellow: dark ? '#f2cc85' : '#c08420',
    brightBlue: dark ? '#a6cdf0' : '#4f8bc6',
    brightMagenta: dark ? '#e6bfee' : '#a065b5',
    brightCyan: dark ? '#9fd8d8' : '#2f9494',
    brightWhite: dark ? '#f3ede6' : '#27221d'
  }
}

function TerminalView({ session, active, onReady, onExit }: { session: Session; active: boolean; onReady: (id: string, title: string) => void; onExit: (err?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idRef = useRef<string | null>(null)
  const dark = useUi((s) => s.dark)
  const fontSize = useSettings((s) => s.settings.terminal.fontSize)

  useEffect(() => {
    if (!ref.current) return
    const term = new Terminal({
      fontFamily: "'SF Mono', 'JetBrains Mono Variable', Menlo, 'Cascadia Mono', Consolas, monospace",
      fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 5000,
      theme: xtermTheme(useUi.getState().dark)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current)
    if (isWin) {
      // xterm reflows differently for ConPTY; without this, resizing loses or garbles lines.
      void getAppInfo().then((info) => {
        term.options.windowsPty = { backend: 'conpty', buildNumber: info.windowsBuild }
      })
    }
    termRef.current = term
    fitRef.current = fit
    try {
      fit.fit()
    } catch {
      // not visible yet
    }
    let offData: (() => void) | null = null
    let offExit: (() => void) | null = null
    let disposed = false
    void api.terminal.create({ cols: term.cols, rows: term.rows }).then((res) => {
      if (disposed) {
        if ('id' in res) api.terminal.kill(res.id)
        return
      }
      if ('error' in res) {
        term.write(`\x1b[31m${res.error}\x1b[0m\r\n`)
        onExit(res.error)
        return
      }
      idRef.current = res.id
      onReady(res.id, res.shell)
      offData = api.terminal.onData(res.id, (d) => term.write(d))
      offExit = api.terminal.onExit(res.id, () => {
        term.write('\r\n\x1b[2mProcess ended.\x1b[0m\r\n')
        onExit()
      })
    })
    term.onData((d) => {
      if (idRef.current) api.terminal.write(idRef.current, d)
    })
    term.onResize(({ cols, rows }) => {
      if (idRef.current) api.terminal.resize(idRef.current, cols, rows)
    })
    // Copy on Cmd+C / Ctrl+Shift+C when text is selected, paste with Cmd+V / Ctrl+Shift+V.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const copy = isMac ? e.metaKey && e.key === 'c' : e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c'
      const paste = isMac ? e.metaKey && e.key === 'v' : e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v'
      if (copy && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      // Windows Terminal convention: Ctrl+V pastes too.
      const plainPaste = !isMac && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v'
      if ((paste || plainPaste) && !isMac) {
        void navigator.clipboard.readText().then((t) => term.paste(t))
        return false
      }
      if (!isMac && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      return true
    })
    // Right click copies the selection, or pastes when nothing is selected (as in Windows Terminal).
    const onContextMenu = (e: MouseEvent) => {
      if (isMac) return
      e.preventDefault()
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
      } else void navigator.clipboard.readText().then((t) => term.paste(t))
    }
    ref.current.addEventListener('contextmenu', onContextMenu)
    const host = ref.current
    const ro = new ResizeObserver(() => {
      if (ref.current && ref.current.offsetWidth > 0 && ref.current.offsetHeight > 0) {
        try {
          fit.fit()
        } catch {
          // ignore transient layout states
        }
      }
    })
    ro.observe(ref.current)
    return () => {
      disposed = true
      host.removeEventListener('contextmenu', onContextMenu)
      ro.disconnect()
      offData?.()
      offExit?.()
      if (idRef.current) api.terminal.kill(idRef.current)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(dark)
  }, [dark])

  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
    } catch {
      // ignore
    }
  }, [fontSize])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
        } catch {
          // ignore
        }
        termRef.current?.focus()
      })
    }
  }, [active])

  return <div className={cx('terminal-view', !active && 'is-hidden')} ref={ref} />
}

let counter = 0

export function TerminalPanel() {
  const [sessions, setSessions] = useState<Session[]>(() => [{ key: `k${++counter}`, id: null, title: 'Terminal' }])
  const [active, setActive] = useState(sessions[0].key)

  const add = useCallback(() => {
    const s = { key: `k${++counter}`, id: null, title: 'Terminal' }
    setSessions((list) => [...list, s])
    setActive(s.key)
  }, [])

  const remove = useCallback((key: string) => {
    setSessions((list) => {
      const next = list.filter((s) => s.key !== key)
      if (!next.length) {
        void useSettings.getState().update({ layout: { terminalVisible: false } })
        const fresh = { key: `k${++counter}`, id: null, title: 'Terminal' }
        setActive(fresh.key)
        return [fresh]
      }
      setActive((cur) => (cur === key ? next[next.length - 1].key : cur))
      return next
    })
  }, [])

  useEffect(() => {
    const onNew = () => {
      if (!useSettings.getState().settings.layout.terminalVisible) void useSettings.getState().update({ layout: { terminalVisible: true } })
      add()
    }
    window.addEventListener('hearth:new-terminal', onNew)
    return () => window.removeEventListener('hearth:new-terminal', onNew)
  }, [add])

  return (
    <section className="terminal-card">
      <div className="terminal-head">
        <div className="terminal-tabs">
          {sessions.map((s, i) => (
            <button key={s.key} className={cx('terminal-tab', s.key === active && 'is-active', s.exited && 'is-exited')} onClick={() => setActive(s.key)}>
              <span>{sessions.length > 1 ? `${s.title} ${i + 1}` : s.title}</span>
              <span
                className="terminal-tab-x"
                role="button"
                aria-label="Close terminal"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(s.key)
                }}
              >
                <X size={11} strokeWidth={2.2} />
              </span>
            </button>
          ))}
        </div>
        <IconButton label="New terminal" onClick={add} className="sm">
          <Plus size={14} strokeWidth={1.9} />
        </IconButton>
        <IconButton label="Hide terminal" shortcut="ctrl+`" onClick={() => void useSettings.getState().update({ layout: { terminalVisible: false } })} className="sm">
          <X size={14} strokeWidth={1.9} />
        </IconButton>
      </div>
      <div className="terminal-body">
        {sessions.map((s) => (
          <TerminalView
            key={s.key}
            session={s}
            active={s.key === active}
            onReady={(id, title) => setSessions((list) => list.map((x) => (x.key === s.key ? { ...x, id, title } : x)))}
            onExit={(error) => setSessions((list) => list.map((x) => (x.key === s.key ? { ...x, exited: true, error } : x)))}
          />
        ))}
      </div>
    </section>
  )
}
