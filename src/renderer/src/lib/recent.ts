// Files opened most recently, shown first in quick open.

const recent: string[] = []

export function rememberRecentFile(path: string): void {
  const i = recent.indexOf(path)
  if (i >= 0) recent.splice(i, 1)
  recent.unshift(path)
  if (recent.length > 30) recent.length = 30
}

export function recentFiles(): readonly string[] {
  return recent
}
