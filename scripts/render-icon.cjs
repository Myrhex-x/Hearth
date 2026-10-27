// Renders build/icon.svg to PNGs with Electron: `npx electron scripts/render-icon.cjs`
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG())
  writeFileSync(join(__dirname, '..', 'resources', 'icon.png'), image.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  app.quit()
})
