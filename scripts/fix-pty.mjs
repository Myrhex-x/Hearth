// node-pty's prebuilt macOS/Linux spawn-helper is published without the
// executable bit, which makes every terminal fail with "posix_spawnp failed".
import { chmodSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

if (process.platform !== 'win32') {
  const root = join(process.cwd(), 'node_modules', 'node-pty')
  const candidates = [join(root, 'build', 'Release', 'spawn-helper')]
  const prebuilds = join(root, 'prebuilds')
  if (existsSync(prebuilds)) for (const dir of readdirSync(prebuilds)) candidates.push(join(prebuilds, dir, 'spawn-helper'))
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      chmodSync(file, 0o755)
    } catch (err) {
      console.warn(`[fix-pty] could not chmod ${file}: ${err.message}`)
    }
  }
}
