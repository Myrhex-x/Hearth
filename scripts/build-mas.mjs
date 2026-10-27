// Builds Hearth for the Mac App Store, in its sandboxed store edition.
//
//   APPLE_TEAM_ID=XXXXXXXXXX node scripts/build-mas.mjs --local
//       Ad-hoc signed and sandboxed, to try the store edition on this Mac.
//       Lands in release/mas-arm64/Hearth.app.
//
//   APPLE_TEAM_ID=XXXXXXXXXX MAS_PROVISIONING_PROFILE=path/to/profile.provisionprofile node scripts/build-mas.mjs
//       Signed .pkg for App Store Connect, from the "Apple Distribution" and
//       "Mac Installer Distribution" certificates in the keychain.
//       Lands in release/Hearth-<version>-mas-arm64.pkg.
//
// Each build is numbered with the time it was made, in UTC, like 2026.1027.1530:
// App Store Connect takes a Mac build only when its number is higher than
// every build uploaded before, whatever the version.
//
// The Team ID stays out of the repository: it only goes into build/.mas/,
// which git ignores. docs/app-store.md walks through the whole submission.

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { build, Platform, Arch } = require('electron-builder')
const yaml = require('js-yaml')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const local = process.argv.includes('--local')
const team = process.env.APPLE_TEAM_ID ?? ''
const profile = process.env.MAS_PROVISIONING_PROFILE ?? ''

function fail(message) {
  console.error(`build-mas: ${message}`)
  process.exit(1)
}

if (!/^[A-Z0-9]{10}$/.test(team)) fail('set APPLE_TEAM_ID to the 10-character Team ID from developer.apple.com, Membership.')
if (!local && !existsSync(profile)) fail('set MAS_PROVISIONING_PROFILE to the Mac App Store provisioning profile for dev.myrhex.hearth.')
if (!local) {
  // Both certificates now, rather than a build that fails at its very end without them.
  const identities = execFileSync('security', ['find-identity', '-v'], { encoding: 'utf8' }).split('\n')
  const has = (type) => identities.some((line) => line.includes(`"${type}: `) && line.includes(`(${team})"`))
  if (!has('Apple Distribution') && !has('3rd Party Mac Developer Application')) fail(`no Apple Distribution certificate for team ${team} in the keychain.`)
  // The keychain names a Mac Installer Distribution certificate this way.
  if (!has('3rd Party Mac Developer Installer')) fail(`no Mac Installer Distribution certificate for team ${team} in the keychain.`)
}
if (!existsSync(join(root, 'out', 'main', 'index.js'))) fail('build the app first: npx electron-vite build')
if (!existsSync(join(root, 'engine', 'mac-arm64', 'llama-server'))) execFileSync(process.execPath, [join(root, 'scripts', 'fetch-engine.mjs'), '--target', 'mac-arm64'], { stdio: 'inherit' })

const generated = join(root, 'build', '.mas')
mkdirSync(generated, { recursive: true })
const entitlements = join(generated, 'entitlements.mas.plist')
writeFileSync(entitlements, readFileSync(join(root, 'build', 'entitlements.mas.plist'), 'utf8').replaceAll('TEAM_ID', team))

const config = yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
const now = new Date()
config.buildVersion = `${now.getUTCFullYear()}.${(now.getUTCMonth() + 1) * 100 + now.getUTCDate()}.${now.getUTCHours() * 100 + now.getUTCMinutes()}`
config.mas = {
  category: 'public.app-category.developer-tools',
  icon: 'build/icon.icns',
  entitlements,
  entitlementsInherit: join(root, 'build', 'entitlements.mas.inherit.plist'),
  hardenedRuntime: false,
  type: local ? 'development' : 'distribution',
  // Electron's App Store build names its shared resources after the team.
  extendInfo: { ElectronTeamID: team, ITSAppUsesNonExemptEncryption: false },
  artifactName: 'Hearth-${version}-mas-${arch}.${ext}',
  ...(local
    ? // Ad-hoc: no certificate, and no application identifier, which macOS only accepts with a profile.
      { identity: '-', preAutoEntitlements: false }
    : // The team's certificates, found by Team ID. Left unset, the mac section's ad-hoc identity would carry over.
      { identity: team, provisioningProfile: profile })
}

// electron-builder reads Info.plist additions from the mac section, also for App Store builds.
config.mac = { ...config.mac, extendInfo: { ...config.mac?.extendInfo, ...config.mas.extendInfo } }

const app = join(root, 'release', 'mas-arm64', 'Hearth.app')
try {
  await build({ targets: Platform.MAC.createTarget(['mas'], Arch.arm64), config, publish: 'never' })
} catch (err) {
  // An ad-hoc build cannot sign the installer package; the app itself is done by then.
  if (!local || !/Installer/.test(String(err?.message ?? err)) || !existsSync(app)) throw err
}

if (local) {
  // extendInfo does not reach a build signed this way: add the key and seal the app again.
  const plist = join(app, 'Contents', 'Info.plist')
  if (!readFileSync(plist, 'utf8').includes('ElectronTeamID')) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :ElectronTeamID string ${team}`, plist])
    execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', entitlements, app])
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', app])
  console.log(`build-mas: sandboxed store edition ready at ${app}`)
} else {
  console.log('build-mas: done. Upload release/Hearth-*-mas-arm64.pkg with Transporter (docs/app-store.md).')
}
