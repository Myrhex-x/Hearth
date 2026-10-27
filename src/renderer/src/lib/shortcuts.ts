import { isMac } from '../api'
import { useUi } from '../state/ui'
import { COMMANDS, runCommand } from './commands'
import { matches } from './keys'

// Global shortcuts, caught in the capture phase so they work while Monaco,
// the terminal or a text field has focus.

const EDITOR_ONLY = new Set(['editor.find'])
const PASS_TO_FIELDS = new Set(['editor.find', 'editor.wordWrap'])

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return
    const ui = useUi.getState()
    if (ui.palette || ui.settings) {
      if (!matches(e, 'mod+shift+p') && !matches(e, 'mod+p')) return
    }
    // Ctrl and + (Shift+= on US keyboards, its own key on French and German ones) or the keypad.
    if (!isMac && e.ctrlKey && !e.altKey && !e.metaKey) {
      const zoom = e.key === '+' || e.code === 'NumpadAdd' ? 'view.zoomIn' : e.code === 'NumpadSubtract' ? 'view.zoomOut' : null
      if (zoom) {
        e.preventDefault()
        runCommand(zoom)
        return
      }
    }
    const target = e.target as HTMLElement | null
    const inMonaco = !!target?.closest?.('.monaco-editor')
    const inTerminal = !!target?.closest?.('.xterm')
    const inField = !inMonaco && !inTerminal && !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    for (const cmd of COMMANDS) {
      if (!cmd.shortcut || !matches(e, cmd.shortcut)) continue
      if (EDITOR_ONLY.has(cmd.id) && !inMonaco) return
      if (inField && PASS_TO_FIELDS.has(cmd.id)) return
      // In the terminal, let Ctrl+letter reach the shell on Windows and Linux (Ctrl+C, Ctrl+L...).
      if (inTerminal && !isMac && cmd.shortcut.startsWith('mod+') && !cmd.shortcut.includes('shift') && cmd.id !== 'view.terminal') {
        if (!['palette.files', 'view.sidebar'].includes(cmd.id)) return
      }
      if (cmd.id === 'ai.inlineEdit' && !inMonaco) return
      e.preventDefault()
      e.stopPropagation()
      runCommand(cmd.id)
      return
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
