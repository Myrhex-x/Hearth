import { createHash, type Hash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, promises as fs, type WriteStream } from 'fs'
import { once } from 'events'
import { Agent, fetch } from 'undici'

// Model files are gigabytes, so a download picks up where it stopped, and the
// file only gets its real name once its size and SHA-256 match.

// A connection that goes quiet for a minute is dropped; the next try resumes.
const agent = new Agent({ headersTimeout: 30_000, bodyTimeout: 60_000, connect: { timeout: 15_000 } })

export interface FileDownload {
  url: string
  dest: string
  size: number
  sha256: string
  signal?: AbortSignal
  /** Bytes of this file on disk so far. */
  onProgress?: (bytes: number) => void
}

async function hashOf(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
}

async function close(out: WriteStream): Promise<void> {
  if (out.closed) return
  out.end()
  await once(out, 'close')
}

export async function downloadFile(d: FileDownload): Promise<void> {
  if (existsSync(d.dest)) {
    if ((await fs.stat(d.dest)).size === d.size) return
    await fs.rm(d.dest, { force: true })
  }
  const part = d.dest + '.part'
  let have = existsSync(part) ? (await fs.stat(part)).size : 0
  if (have > d.size) {
    await fs.rm(part, { force: true })
    have = 0
  }
  let hash = createHash('sha256')
  if (have > 0) await hashOf(part, hash)
  d.onProgress?.(have)

  if (have < d.size) {
    const res = await fetch(d.url, { headers: have ? { range: `bytes=${have}-` } : {}, signal: d.signal, dispatcher: agent })
    if (have > 0 && res.status === 200) {
      // The server sent the whole file instead of the rest: start over.
      have = 0
      hash = createHash('sha256')
    } else if (!res.ok) {
      throw new Error(res.status === 404 ? 'The file is no longer at its address.' : `The download server answered ${res.status}.`)
    }
    if (!res.body) throw new Error('The download server sent nothing.')
    const out = createWriteStream(part, { flags: have ? 'a' : 'w' })
    try {
      for await (const chunk of res.body) {
        const bytes = chunk as Uint8Array
        have += bytes.length
        if (have > d.size) throw new Error('The file is larger than expected.')
        hash.update(bytes)
        if (!out.write(bytes)) await once(out, 'drain')
        d.onProgress?.(have)
      }
    } finally {
      // Keep what arrived, so the next try resumes from there.
      await close(out)
    }
  }

  if (have !== d.size) throw new Error('The download stopped early. Try again to continue it.')
  if (hash.digest('hex') !== d.sha256) {
    await fs.rm(part, { force: true })
    throw new Error('The file did not match its checksum, so it was deleted. Try again.')
  }
  await fs.rename(part, d.dest)
}
