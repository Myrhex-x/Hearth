// electron-builder hook: make node-pty's spawn-helper executable in the packaged app.
const { chmodSync, existsSync, readdirSync, statSync } = require('fs')
const { join } = require('path')

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (name === 'spawn-helper') out.push(p)
  }
  return out
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') return
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
  const unpacked = join(resources, 'app.asar.unpacked')
  if (!existsSync(unpacked)) return
  for (const file of walk(unpacked, [])) chmodSync(file, 0o755)
}
