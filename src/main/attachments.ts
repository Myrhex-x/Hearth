import { app } from 'electron'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'

// Images attached to chat messages live here once, named by their content,
// so the chat history stays small and the same screenshot is stored once.

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const ID = /^[a-f0-9]{24}\.(png|jpg|webp|gif)$/

function folder(): string {
  return join(app.getPath('userData'), 'attachments')
}

export async function saveAttachment(base64: string, mime: string): Promise<string> {
  const ext = EXT[mime]
  if (!ext) throw new Error(`Images of type ${mime} are not supported`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > 20 * 1024 * 1024) throw new Error('This image is too large (over 20 MB)')
  const id = `${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${ext}`
  await fs.mkdir(folder(), { recursive: true })
  const file = join(folder(), id)
  try {
    await fs.access(file)
  } catch {
    await fs.writeFile(file, bytes)
  }
  return id
}

export async function readAttachment(id: string): Promise<string | null> {
  if (!ID.test(id)) return null
  try {
    return (await fs.readFile(join(folder(), id))).toString('base64')
  } catch {
    return null
  }
}
