import { describe, expect, it } from 'vitest'
import { ndjson, sse } from '../../src/main/llm/stream'
import { parseToolArguments } from '../../src/main/llm/openai'

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p))
      c.close()
    }
  })
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of gen) out.push(v)
  return out
}

describe('stream readers', () => {
  it('parses NDJSON split mid-line', async () => {
    const out = await collect(ndjson(streamOf(['{"a":1}\n{"a"', ':2}\n\n{"a":3}'])))
    expect(out).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })

  it('parses SSE with CRLF and stops at [DONE]', async () => {
    const out = await collect(sse(streamOf(['data: {"x":1}\r\n\r\n: ping\r\n\r\ndata: {"x"', ':2}\n\ndata: [DONE]\n\ndata: {"x":3}\n\n'])))
    expect(out).toEqual([{ x: 1 }, { x: 2 }])
  })

  it('repairs common tool argument mistakes', () => {
    expect(parseToolArguments('{"path": "a.ts",}')).toEqual({ path: 'a.ts' })
    expect(parseToolArguments('{"path": "a.ts"')).toEqual({ path: 'a.ts' })
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('nonsense')).toEqual({ _raw: 'nonsense' })
  })
})
