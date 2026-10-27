// electron-builder hook: fail the build if the model engine is missing, and
// make node-pty's spawn-helper and the engine executable in the packaged app.
const { chmodSync, existsSync, readdirSync, statSync } = require('fs')
const { join } = require('path')
const { Arch } = require('electron-builder')

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
  const platform = context.electronPlatformName
  // "mas" is the Mac App Store build: an app bundle like "darwin".
  const mac = platform === 'darwin' || platform === 'mas'
  const resources = mac
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const engine = join(resources, 'engine')
  const server = join(engine, platform === 'win32' ? 'llama-server.exe' : 'llama-server')
  if (!existsSync(server)) {
    const os = { darwin: 'mac', mas: 'mac', win32: 'win', linux: 'linux' }[platform]
    throw new Error(`The model engine is missing from ${resources}. Run: npm run engine -- --target ${os}-${Arch[context.arch]}`)
  }
  if (platform === 'win32') {
    // The engine links the Visual C++ runtime, which not every Windows has (see scripts/fetch-engine.mjs).
    const missing = ['vcruntime140.dll', 'msvcp140.dll'].filter((f) => !existsSync(join(engine, f)))
    if (missing.length && process.platform === 'win32') throw new Error(`The model engine is missing ${missing.join(' and ')}. Run npm run engine on Windows.`)
    if (missing.length) console.warn('  • the Windows engine has no Visual C++ runtime: build on Windows to include it')
    return
  }
  chmodSync(server, 0o755)
  const unpacked = join(resources, 'app.asar.unpacked')
  if (!existsSync(unpacked)) return
  for (const file of walk(unpacked, [])) chmodSync(file, 0o755)
}
