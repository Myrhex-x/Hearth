import path from 'path'

type PathImpl = typeof path.posix

/** Turns a native relative path into the forward-slash form the renderer uses. */
export function toPosix(p: string, impl: PathImpl = path): string {
  return impl.sep === '\\' ? p.split('\\').join('/') : p
}

export function isInside(root: string, abs: string, impl: PathImpl = path): boolean {
  const rel = impl.relative(impl.resolve(root), impl.resolve(abs))
  if (rel === '') return true
  if (impl.isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith('..' + impl.sep) && !rel.startsWith('../')
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * Names Windows cannot store faithfully: "a:b" would become an alternate data
 * stream, "nul.ts" a device, and a trailing dot or space is silently dropped.
 */
function checkWindowsNames(rel: string, input: string): void {
  for (const part of rel.split('/')) {
    if (!part || part === '.' || part === '..') continue
    if (/[<>:"|?*\x00-\x1f]/.test(part) || WIN_RESERVED.test(part) || /[. ]$/.test(part)) {
      throw new Error(`"${part}" is not a valid file name on Windows: ${input}`)
    }
  }
}

/**
 * Resolves a path given by the UI or by a model to an absolute path inside the
 * workspace. Accepts "src/a.ts", "./src/a.ts", "src\\a.ts", and "/src/a.ts"
 * (models often mean the project root by a leading slash). Throws for anything
 * that would land outside the root.
 */
export function resolveInside(root: string, input: string, impl: PathImpl = path): string {
  const base = impl.resolve(root)
  let rel = String(input ?? '').trim().replace(/\\/g, '/')
  if (rel === '' || rel === '.' || rel === './') return base
  const looksAbsolute = rel.startsWith('/') || /^[a-zA-Z]:\//.test(rel)
  if (looksAbsolute) {
    const candidate = impl.resolve(impl.sep === '\\' ? rel.replace(/\//g, '\\') : rel)
    if (isInside(base, candidate, impl)) return candidate
    if (/^[a-zA-Z]:\//.test(rel)) throw new Error(`Path is outside the project: ${input}`)
    rel = rel.replace(/^\/+/, '')
  }
  if (impl.sep === '\\') checkWindowsNames(rel, input)
  const abs = impl.resolve(base, impl.sep === '\\' ? rel.replace(/\//g, '\\') : rel)
  if (!isInside(base, abs, impl)) throw new Error(`Path is outside the project: ${input}`)
  return abs
}

export function relativeTo(root: string, abs: string, impl: PathImpl = path): string {
  return toPosix(impl.relative(impl.resolve(root), abs), impl)
}
