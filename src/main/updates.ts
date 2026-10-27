import { app } from 'electron'
import type { UpdateInfo } from '../shared/types'
import { isNewer } from '../shared/version'
import { http } from './llm/http'

// Only runs when the person asks: Hearth makes no network requests of its own otherwise.

const RELEASES = 'https://github.com/Myrhex-x/Hearth/releases/latest'

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const res = await http('https://api.github.com/repos/Myrhex-x/Hearth/releases/latest', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Hearth/${current}` },
      timeoutMs: 8000
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').replace(/^v/i, '')
    return { current, latest: latest || null, newer: !!latest && isNewer(latest, current), url: data.html_url ?? RELEASES }
  } catch (err) {
    return { current, latest: null, newer: false, url: RELEASES, error: (err as Error).message || String(err) }
  }
}
