import { api, isMac, isWin } from '../api'
import { startInlineEdit } from '../editor/inlineEdit'
import { useChat } from '../state/chat'
import { activeTab, editorHost, useEditor } from '../state/editor'
import { closeFolder, openFolder } from '../state/session'
import { settingsNow, useSettings } from '../state/settings'
import { toast, useUi } from '../state/ui'
import { useWorkspace } from '../state/workspace'
import { dirname } from './paths'

export interface Command {
  id: string
  title: string
  shortcut?: string
  needsFolder?: boolean
  run: () => void | Promise<void>
}

let zoom = 0

function toggleLayout(key: 'sidebarVisible' | 'chatVisible' | 'terminalVisible'): void {
  const layout = settingsNow().layout
  void useSettings.getState().update({ layout: { [key]: !layout[key] } })
}

export function addSelectionToChat(): void {
  const ed = editorHost.editor
  const tab = activeTab()
  if (!settingsNow().layout.chatVisible) void useSettings.getState().update({ layout: { chatVisible: true } })
  if (ed && tab?.kind === 'file') {
    const sel = ed.getSelection()
    const model = ed.getModel()
    if (sel && model && !sel.isEmpty()) {
      const endLine = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber
      const text = model.getValueInRange({ startLineNumber: sel.startLineNumber, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine) })
      useChat.getState().addChip({ kind: 'selection', path: tab.path, startLine: sel.startLineNumber, endLine, text })
    }
  }
  useUi.getState().focusChat()
}

function newFile(): void {
  if (!useWorkspace.getState().info) return
  const ws = useWorkspace.getState()
  const sel = ws.selected
  let parent = ''
  if (sel) {
    const kind = Object.prototype.hasOwnProperty.call(ws.children, sel) ? 'dir' : 'file'
    parent = kind === 'dir' ? sel : dirname(sel)
  }
  if (!settingsNow().layout.sidebarVisible) void useSettings.getState().update({ layout: { sidebarVisible: true } })
  useUi.setState({ sidebarTab: 'files' })
  ws.startEdit({ kind: 'new-file', parent })
}

export const COMMANDS: Command[] = [
  { id: 'workspace.open', title: 'Open Folder…', shortcut: 'mod+o', run: () => openFolder() },
  { id: 'workspace.close', title: 'Close Folder', needsFolder: true, run: () => closeFolder() },
  { id: 'window.new', title: 'New Window', shortcut: 'mod+shift+n', run: () => api.app.newWindow() },
  { id: 'file.new', title: 'New File', shortcut: 'mod+n', needsFolder: true, run: newFile },
  { id: 'file.save', title: 'Save', shortcut: 'mod+s', needsFolder: true, run: () => useEditor.getState().save() },
  { id: 'file.saveAll', title: 'Save All', shortcut: 'mod+alt+s', needsFolder: true, run: () => useEditor.getState().saveAll() },
  {
    id: 'tab.close',
    title: 'Close Tab',
    shortcut: 'mod+w',
    run: () => {
      const id = useEditor.getState().activeId
      if (id) void useEditor.getState().closeTab(id)
    }
  },
  { id: 'tab.next', title: 'Next Tab', shortcut: 'ctrl+tab', run: () => useEditor.getState().cycle(1) },
  { id: 'tab.prev', title: 'Previous Tab', shortcut: 'ctrl+shift+tab', run: () => useEditor.getState().cycle(-1) },
  { id: 'palette.files', title: 'Go to File…', shortcut: 'mod+p', needsFolder: true, run: () => useUi.getState().openPalette('files') },
  { id: 'palette.commands', title: 'Show All Commands', shortcut: 'mod+shift+p', run: () => useUi.getState().openPalette('commands') },
  { id: 'search.focus', title: 'Find in Project', shortcut: 'mod+shift+f', needsFolder: true, run: () => {
      if (!settingsNow().layout.sidebarVisible) void useSettings.getState().update({ layout: { sidebarVisible: true } })
      useUi.getState().focusSearch()
    } },
  { id: 'editor.find', title: 'Find in File', shortcut: 'mod+f', run: () => editorHost.editor?.getAction('actions.find')?.run() },
  { id: 'view.sidebar', title: 'Toggle Sidebar', shortcut: 'mod+b', run: () => toggleLayout('sidebarVisible') },
  { id: 'view.chat', title: 'Toggle Chat', shortcut: 'mod+alt+b', run: () => toggleLayout('chatVisible') },
  { id: 'view.terminal', title: 'Toggle Terminal', shortcut: 'ctrl+`', run: () => toggleLayout('terminalVisible') },
  { id: 'terminal.new', title: 'New Terminal', run: () => window.dispatchEvent(new CustomEvent('hearth:new-terminal')) },
  { id: 'chat.new', title: 'New Chat', shortcut: 'mod+shift+l', run: () => {
      useChat.getState().newThread()
      if (!settingsNow().layout.chatVisible) void useSettings.getState().update({ layout: { chatVisible: true } })
      useUi.getState().focusChat()
    } },
  { id: 'ai.addToChat', title: 'Add Selection to Chat', shortcut: 'mod+l', run: addSelectionToChat },
  { id: 'ai.inlineEdit', title: 'Edit Selection with AI', shortcut: 'mod+k', needsFolder: true, run: () => startInlineEdit() },
  {
    id: 'ai.toggleAutocomplete',
    title: 'Toggle Autocomplete',
    run: () => {
      const on = !settingsNow().autocompleteEnabled
      void useSettings.getState().update({ autocompleteEnabled: on })
      toast(on ? 'Autocomplete is on' : 'Autocomplete is off')
    }
  },
  { id: 'models.open', title: 'Manage Models', run: () => useUi.getState().setModelsOpen(true) },
  { id: 'settings.open', title: 'Settings', shortcut: 'mod+,', run: () => useUi.getState().openSettings() },
  { id: 'theme.system', title: 'Appearance: Match System', run: () => useSettings.getState().update({ theme: 'system' }) },
  { id: 'theme.light', title: 'Appearance: Light', run: () => useSettings.getState().update({ theme: 'light' }) },
  { id: 'theme.dark', title: 'Appearance: Dark', run: () => useSettings.getState().update({ theme: 'dark' }) },
  {
    id: 'editor.wordWrap',
    title: 'Toggle Word Wrap',
    shortcut: 'alt+z',
    run: () => useSettings.getState().update({ editor: { wordWrap: !settingsNow().editor.wordWrap } })
  },
  { id: 'editor.minimap', title: 'Toggle Minimap', run: () => useSettings.getState().update({ editor: { minimap: !settingsNow().editor.minimap } }) },
  {
    id: 'file.reveal',
    title: isMac ? 'Reveal in Finder' : isWin ? 'Show in File Explorer' : 'Show in Files',
    needsFolder: true,
    run: () => {
      const tab = activeTab()
      api.app.revealPath(tab?.path ?? '')
    }
  },
  ...(isMac
    ? []
    : [
        { id: 'view.zoomIn', title: 'Zoom In', shortcut: 'mod+=', run: () => api.app.setZoom(++zoom) },
        { id: 'view.zoomOut', title: 'Zoom Out', shortcut: 'mod+-', run: () => api.app.setZoom(--zoom) },
        { id: 'view.zoomReset', title: 'Actual Size', shortcut: 'mod+0', run: () => api.app.setZoom((zoom = 0)) }
      ])
]

export function runCommand(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id)
  if (!cmd) return
  if (cmd.needsFolder && !useWorkspace.getState().info) return
  void cmd.run()
}
