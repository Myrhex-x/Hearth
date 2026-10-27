// The Mac App Store edition runs in Apple's sandbox. Anything Hearth starts
// runs in it too, so a shell could not reach the tools in the user's home
// folder: this edition has no terminal and the agent does not run commands.
// It has no update check of its own (the App Store updates it), and it opens
// folders through security-scoped bookmarks so they reopen after a restart.
//
// Electron's App Store build sets process.mas. HEARTH_STORE_EDITION=1 tries
// the same behavior in a regular build.

export const storeEdition = (process as { mas?: boolean }).mas === true || process.env.HEARTH_STORE_EDITION === '1'

/** Thrown when the sandbox needs the user to pick a folder again; the interface reacts to the prefix. */
export const NEEDS_PERMISSION = 'NEEDS_PERMISSION'
