// Splits a token stream into visible text and reasoning when a model writes its
// reasoning inline as <think>...</think> instead of using a separate field.
// Tags can arrive split across chunks, so a possible partial tag is held back.

const OPEN = '<think>'
const CLOSE = '</think>'

export interface SplitChunk {
  content: string
  thinking: string
}

function partialSuffix(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1)
  for (let len = max; len > 0; len--) {
    if (tag.startsWith(text.slice(text.length - len))) return len
  }
  return 0
}

export class ThinkSplitter {
  private inThink = false
  private buffer = ''

  push(text: string): SplitChunk {
    this.buffer += text
    const out: SplitChunk = { content: '', thinking: '' }
    for (;;) {
      const tag = this.inThink ? CLOSE : OPEN
      const at = this.buffer.indexOf(tag)
      if (at >= 0) {
        const before = this.buffer.slice(0, at)
        if (this.inThink) out.thinking += before
        else out.content += before
        this.buffer = this.buffer.slice(at + tag.length)
        this.inThink = !this.inThink
        continue
      }
      const keep = partialSuffix(this.buffer, tag)
      const emit = this.buffer.slice(0, this.buffer.length - keep)
      if (this.inThink) out.thinking += emit
      else out.content += emit
      this.buffer = this.buffer.slice(this.buffer.length - keep)
      return out
    }
  }

  flush(): SplitChunk {
    const rest = this.buffer
    this.buffer = ''
    return this.inThink ? { content: '', thinking: rest } : { content: rest, thinking: '' }
  }
}
