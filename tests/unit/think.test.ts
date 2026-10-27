import { describe, expect, it } from 'vitest'
import { ThinkSplitter } from '../../src/shared/think'

function run(chunks: string[]) {
  const s = new ThinkSplitter()
  let content = ''
  let thinking = ''
  for (const c of chunks) {
    const out = s.push(c)
    content += out.content
    thinking += out.thinking
  }
  const rest = s.flush()
  return { content: content + rest.content, thinking: thinking + rest.thinking }
}

describe('ThinkSplitter', () => {
  it('separates reasoning from the answer', () => {
    expect(run(['<think>plan</think>answer'])).toEqual({ content: 'answer', thinking: 'plan' })
  })

  it('handles tags split across chunks', () => {
    expect(run(['<th', 'ink>a', 'b</thi', 'nk>', 'done'])).toEqual({ content: 'done', thinking: 'ab' })
  })

  it('passes plain text through, including a lone "<"', () => {
    expect(run(['if a < b ', 'then'])).toEqual({ content: 'if a < b then', thinking: '' })
  })
})
