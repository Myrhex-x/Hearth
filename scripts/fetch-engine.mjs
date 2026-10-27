// Downloads llama.cpp's llama-server, the engine that runs models inside
// Hearth, into engine/<os>-<arch>/. electron-builder copies that folder into
// the app. The build is pinned and every archive is checked against its
// SHA-256 before anything is unpacked.
//
//   node scripts/fetch-engine.mjs                  this computer
//   node scripts/fetch-engine.mjs --target win-x64 --target win-arm64
//   node scripts/fetch-engine.mjs --optional       warn instead of failing (postinstall)

import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { copyFileSync, createReadStream, existsSync, promises as fs, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BUILD = 'b11622'
const TARGETS = {
  'mac-arm64': { asset: `llama-${BUILD}-bin-macos-arm64.tar.gz`, sha256: '69ce43d516c61e2836c11b7a0fa9e12f38d2a5e33d849ccb58e49394cd855413' },
  'mac-x64': { asset: `llama-${BUILD}-bin-macos-x64.tar.gz`, sha256: '6678e8a16a7cf55c5c51d9fee100681f2a150fe11090dd521f3edb0e6f418a16' },
  // Vulkan reaches NVIDIA, AMD and Intel GPUs; without one it runs on the CPU.
  'win-x64': { asset: `llama-${BUILD}-bin-win-vulkan-x64.zip`, sha256: 'fbcee8344b6e64ff36be512cf50a2d85402e2b52f2bd6db25284ff065d352f04' },
  'win-arm64': { asset: `llama-${BUILD}-bin-win-vulkan-arm64.zip`, sha256: 'c8de36974755b4714ccceb7b2e4e079562f80d973284a9c0b38861e83e4dd3f6' },
  'linux-x64': { asset: `llama-${BUILD}-bin-ubuntu-x64.tar.gz`, sha256: '4c75cc6fbdca7634c6ea84f5c9e760a3d9055786f2fa907fb572d0b128ff06ac' }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'node_modules', '.cache', 'hearth-engine')

function currentTarget() {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
  return `${os}-${process.arch}`
}

/** The server, the libraries it links, the backends it loads at run time, and the license. */
function wanted(name, isLink) {
  if (/^llama-server(\.exe)?$/.test(name)) return !isLink
  if (/^LICENSE/.test(name)) return true
  // Tools we do not ship.
  if (/-impl\.(dll|dylib|so)$/.test(name) && !/^(lib)?llama-server-impl\./.test(name)) return false
  if (/\.dll$/i.test(name)) return true
  // The names the binaries ask for, like libllama.0.dylib or libllama.so.0: links, copied as files.
  if (/^lib[^.]*(\.0\.dylib|\.so\.0)$/.test(name)) return true
  // Unversioned files, like the CPU backends Linux picks from at run time.
  if (/^lib[^.]*\.(dylib|so)$/.test(name)) return !isLink
  return false
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function download(target) {
  const { asset, sha256: expected } = TARGETS[target]
  await fs.mkdir(cacheDir, { recursive: true })
  const file = join(cacheDir, asset)
  if (existsSync(file) && (await sha256(file)) === expected) return file
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/${asset}`
  process.stdout.write(`engine: downloading ${asset}\n`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  await fs.writeFile(file + '.part', Buffer.from(await res.arrayBuffer()))
  const got = await sha256(file + '.part')
  if (got !== expected) {
    await fs.rm(file + '.part', { force: true })
    throw new Error(`${asset}: SHA-256 is ${got}, expected ${expected}`)
  }
  await fs.rename(file + '.part', file)
  return file
}

let license = null

async function licenseText() {
  if (license) return license
  const res = await fetch(`https://raw.githubusercontent.com/ggml-org/llama.cpp/${BUILD}/LICENSE`)
  if (!res.ok) throw new Error(`llama.cpp LICENSE: HTTP ${res.status}`)
  license = await res.text()
  if (!/MIT License/.test(license)) throw new Error('llama.cpp LICENSE: unexpected text')
  return license
}

async function install(target) {
  const archive = await download(target)
  const out = join(root, 'engine', target)
  const stamp = join(out, 'VERSION')
  const needsRuntime = target.startsWith('win') && process.platform === 'win32' && !existsSync(join(out, 'vcruntime140.dll'))
  if (existsSync(stamp) && (await fs.readFile(stamp, 'utf8')).trim() === BUILD && !needsRuntime) {
    process.stdout.write(`engine: ${target} is ${BUILD}\n`)
    return
  }
  const scratch = await fs.mkdtemp(join(tmpdir(), 'hearth-engine-'))
  try {
    // bsdtar on macOS and Windows reads zip and tar.gz alike; Linux only needs tar.gz.
    execFileSync('tar', ['-xf', archive, '-C', scratch])
    const top = (await fs.readdir(scratch, { withFileTypes: true })).find((d) => d.isDirectory())
    const from = top ? join(scratch, top.name) : scratch
    await fs.rm(out, { recursive: true, force: true })
    await fs.mkdir(out, { recursive: true })
    const copied = []
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (!wanted(entry.name, entry.isSymbolicLink())) continue
      const src = join(from, entry.name)
      await fs.copyFile(await fs.realpath(src), join(out, entry.name))
      if (!/\.(dll|txt)$|^LICENSE/i.test(entry.name)) await fs.chmod(join(out, entry.name), 0o755)
      copied.push(entry.name)
    }
    if (!copied.some((n) => /^llama-server(\.exe)?$/.test(n))) throw new Error(`${archive} has no llama-server`)
    // MIT asks for the notice to travel with the binaries; not every archive has it.
    await fs.writeFile(join(out, 'LICENSE-llama.cpp'), await licenseText())
    if (process.platform === 'darwin' && target.startsWith('mac')) checkMacLinks(out)
    if (target.startsWith('win')) copyVcRuntime(target, out)
    await fs.writeFile(stamp, BUILD + '\n')
    process.stdout.write(`engine: ${target} ${BUILD}, ${copied.length} files\n`)
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
}

/**
 * llama.cpp's Windows build links the Visual C++ runtime, which not every
 * Windows has. Microsoft allows shipping it next to the program, so it comes
 * from the Visual Studio that builds Hearth (CI's Windows machines have one).
 */
function copyVcRuntime(target, out) {
  if (process.platform !== 'win32') {
    process.stdout.write(`engine: ${target} also needs the Visual C++ runtime, added when fetched on Windows\n`)
    return
  }
  const arch = target === 'win-arm64' ? 'arm64' : 'x64'
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  const install = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
  const redist = join(install, 'VC', 'Redist', 'MSVC')
  const newest = (a, b) => b.localeCompare(a, undefined, { numeric: true })
  for (const version of readdirSync(redist).filter((v) => /^\d+\.\d+/.test(v)).sort(newest)) {
    const dir = join(redist, version, arch)
    const crt = existsSync(dir) && readdirSync(dir).find((d) => /^Microsoft\.VC\d+\.CRT$/i.test(d))
    if (!crt) continue
    const dlls = readdirSync(join(dir, crt)).filter((f) => /\.dll$/i.test(f))
    for (const f of dlls) copyFileSync(join(dir, crt, f), join(out, f.toLowerCase()))
    process.stdout.write(`engine: ${target} Visual C++ runtime ${version}: ${dlls.join(', ')}\n`)
    return
  }
  throw new Error(`engine: no Visual C++ runtime for ${arch} under ${redist}`)
}

/** Every @rpath library the server needs has to be next to it. Reads the files, runs nothing. */
function checkMacLinks(dir) {
  const missing = new Set()
  for (const name of ['llama-server', 'libllama-server-impl.dylib']) {
    const deps = execFileSync('otool', ['-L', join(dir, name)], { encoding: 'utf8' })
    for (const m of deps.matchAll(/@rpath\/(\S+)/g)) if (!existsSync(join(dir, m[1]))) missing.add(m[1])
  }
  if (missing.size) throw new Error(`engine: missing next to llama-server: ${[...missing].join(', ')}`)
}

const args = process.argv.slice(2)
const optional = args.includes('--optional')
const targets = args.flatMap((a, i) => (args[i - 1] === '--target' ? [a] : []))
if (!targets.length) targets.push(currentTarget())

try {
  for (const t of targets) {
    if (!TARGETS[t]) throw new Error(`No engine build for ${t}. Known: ${Object.keys(TARGETS).join(', ')}`)
    await install(t)
  }
} catch (err) {
  if (!optional) throw err
  process.stdout.write(`engine: skipped (${err.message}). Run "npm run engine" to try again.\n`)
}

