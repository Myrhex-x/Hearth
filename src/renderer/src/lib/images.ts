import { api } from '../api'
import type { ImageAttachment } from '../agent/types'

// Images pasted or dropped into the chat. Vision models work at about 1500
// pixels at most, so anything larger is scaled down before it is stored.

const MAX_SIDE = 1568
const MAX_KEEP_BYTES = 2 * 1024 * 1024
const THUMB_SIDE = 192

function canvasFor(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality))
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function isImageFile(file: File): boolean {
  return /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)
}

export async function prepareImage(file: Blob, name: string): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    let blob: Blob
    let mime: string
    if (scale === 1 && file.size <= MAX_KEEP_BYTES && /^image\/(png|jpeg)$/.test(file.type)) {
      // Small enough already: keep the original pixels, sharp text included.
      blob = file
      mime = file.type
    } else {
      const canvas = canvasFor(width, height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)
      // PNG keeps screenshots of text crisp; photos are much smaller as JPEG.
      const png = await toBlob(canvas, 'image/png')
      if (png.size <= MAX_KEEP_BYTES) {
        blob = png
        mime = 'image/png'
      } else {
        blob = await toBlob(canvas, 'image/jpeg', 0.9)
        mime = 'image/jpeg'
      }
    }
    const thumbScale = Math.min(1, THUMB_SIDE / Math.max(width, height))
    const thumbCanvas = canvasFor(Math.max(1, Math.round(width * thumbScale)), Math.max(1, Math.round(height * thumbScale)))
    thumbCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumb = thumbCanvas.toDataURL('image/jpeg', 0.82)
    const id = await api.attachments.save(await base64Of(blob), mime)
    return { id, name: name || 'image', width, height, thumb }
  } finally {
    bitmap.close()
  }
}

const cache = new Map<string, string>()

/** The stored image as base64, for sending to a model. */
export async function imageData(id: string): Promise<string | null> {
  const hit = cache.get(id)
  if (hit) return hit
  const data = await api.attachments.read(id)
  if (data) {
    cache.set(id, data)
    if (cache.size > 24) cache.delete(cache.keys().next().value!)
  }
  return data
}
