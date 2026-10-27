import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'

// The macOS menu bar. Shortcuts are handled by the renderer so they behave the
// same on Windows (which has no menu bar here); the menu only displays them and
// forwards clicks. Edit roles stay native so copy and paste work everywhere.

function send(command: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:command', command)
}

function item(label: string, command: string, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, registerAccelerator: false, click: () => send(command) }
}

export function buildMenu(createWindow: () => void): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        item('Check for Updates…', 'app.checkUpdates'),
        { type: 'separator' },
        item('Settings…', 'settings.open', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        item('New File', 'file.new', 'Cmd+N'),
        { label: 'New Window', accelerator: 'Cmd+Shift+N', click: () => createWindow() },
        { type: 'separator' },
        item('Open Folder…', 'workspace.open', 'Cmd+O'),
        item('Quick Open…', 'palette.files', 'Cmd+P'),
        { type: 'separator' },
        item('Save', 'file.save', 'Cmd+S'),
        item('Save All', 'file.saveAll', 'Cmd+Alt+S'),
        { type: 'separator' },
        item('Close Tab', 'tab.close', 'Cmd+W'),
        item('Close Folder', 'workspace.close')
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find', 'editor.find', 'Cmd+F'),
        item('Find in Project', 'search.focus', 'Cmd+Shift+F')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Command Palette…', 'palette.commands', 'Cmd+Shift+P'),
        { type: 'separator' },
        item('Toggle Sidebar', 'view.sidebar', 'Cmd+B'),
        item('Toggle Chat', 'view.chat', 'Cmd+Alt+B'),
        item('Toggle Terminal', 'view.terminal', 'Ctrl+`'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Model',
      submenu: [
        item('Edit Selection with AI', 'ai.inlineEdit', 'Cmd+K'),
        item('Add Selection to Chat', 'ai.addToChat', 'Cmd+L'),
        item('New Chat', 'chat.new', 'Cmd+Shift+L'),
        { type: 'separator' },
        item('Toggle Autocomplete', 'ai.toggleAutocomplete'),
        item('Manage Models…', 'models.open')
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Hearth on GitHub', click: () => void shell.openExternal('https://github.com/Myrhex-x/Hearth') },
        { label: 'Report an Issue', click: () => void shell.openExternal('https://github.com/Myrhex-x/Hearth/issues') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
