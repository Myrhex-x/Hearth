import { isMac } from '../api'

// Shortcuts are written once as "mod+shift+p" and mean Cmd on macOS and Ctrl elsewhere.

const CODE_KEYS: Record<string, string> = { '`': 'Backquote', ',': 'Comma', '=': 'Equal', '-': 'Minus', '0': 'Digit0', enter: 'Enter', tab: 'Tab' }

export function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const want = new Set(parts.slice(0, -1))
  // AltGr arrives as Ctrl+Alt on Windows; it types characters (like @ on AZERTY), never shortcuts.
  if (!isMac && e.getModifierState?.('AltGraph')) return false
  // "mod" is Cmd on macOS and Ctrl elsewhere, so on Windows "ctrl" and "mod" mean the same key.
  const wantMeta = isMac && want.has('mod')
  const wantCtrl = want.has('ctrl') || (!isMac && want.has('mod'))
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl) return false
  if (e.shiftKey !== want.has('shift') || e.altKey !== want.has('alt')) return false
  if (CODE_KEYS[key]) return e.code === CODE_KEYS[key] || e.key.toLowerCase() === key
  // Letters follow the keyboard layout (AZERTY users get W where W is printed),
  // except with Alt held on macOS, where e.key turns into a symbol.
  if (key.length === 1 && /[a-z]/.test(key)) {
    // Cyrillic, Greek, Hebrew or Arabic layouts give a non-Latin e.key: use the physical key then.
    if ((e.altKey && isMac) || !/^[a-z]$/i.test(e.key)) return e.code === `Key${key.toUpperCase()}`
    return e.key.toLowerCase() === key
  }
  return e.key.toLowerCase() === key
}

const MAC_SYMBOLS: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↩', backspace: '⌫', escape: 'esc', tab: '⇥' }

export function shortcutLabel(combo: string): string {
  const parts = combo.split('+')
  if (isMac) {
    return parts
      .map((p) => MAC_SYMBOLS[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
      .join('')
  }
  return parts
    .map((p) => {
      const l = p.toLowerCase()
      if (l === 'mod' || l === 'ctrl') return 'Ctrl'
      if (l === 'alt') return 'Alt'
      if (l === 'shift') return 'Shift'
      if (l === 'enter') return 'Enter'
      if (l === 'escape') return 'Esc'
      return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
    })
    .join('+')
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.closest('.monaco-editor')) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}
