import { readlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The Mac App Store edition runs in Apple's sandbox. Anything Hearth starts
// runs in it too, so a shell could not reach the tools in the user's home
// folder: this edition has no terminal and the agent does not run commands.
// It has no update check of its own (the App Store updates it), and it opens
// folders through security-scoped bookmarks so they reopen after a restart.
//
// Electron's App Store build sets process.mas. HEARTH_STORE_EDITION=1 tries
// the same behavior in a regular build.

const masBuild = (process as { mas?: boolean }).mas === true

export const storeEdition = masBuild || process.env.HEARTH_STORE_EDITION === '1'

/** Thrown when the sandbox needs the user to pick a folder again; the interface reacts to the prefix. */
export const NEEDS_PERMISSION = 'NEEDS_PERMISSION'

/**
 * Electron's App Store build keeps the single-instance socket and cookie in a
 * fixed folder of the container, not a fresh one. After a crash or Force Quit
 * they stay behind, the lock fails, and the next launch would quit at once.
 * This clears them when the instance that left them is gone.
 */
export function clearStaleInstanceLock(userData: string): void {
  if (!masBuild) return
  let owner = 0
  try {
    // "<host>-<pid>" while an instance holds the lock.
    owner = Number(readlinkSync(join(userData, 'SingletonLock')).split('-').pop())
  } catch {
    // no lock left behind
  }
  if (Number.isInteger(owner) && owner > 0 && owner !== process.pid) {
    try {
      process.kill(owner, 0)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') return
    }
  }
  rmSync(join(tmpdir(), 'S'), { recursive: true, force: true })
}
