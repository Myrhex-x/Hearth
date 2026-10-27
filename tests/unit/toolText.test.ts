import { describe, expect, it } from 'vitest'
import { extractToolCalls } from '../../src/shared/toolText'

const tools = ['read_file', 'edit_file', 'run_command']

describe('extractToolCalls', () => {
  it('reads <tool_call> blocks', () => {
    const r = extractToolCalls('Let me look.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "src/a.ts"}}\n</tool_call>', tools)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]).toMatchObject({ name: 'read_file', arguments: { path: 'src/a.ts' } })
    expect(r.rest).toBe('Let me look.')
  })

  it('reads fenced JSON naming a known tool', () => {
    const r = extractToolCalls('```json\n{"name": "run_command", "parameters": {"command": "npm test"}}\n```', tools)
    expect(r.calls[0]).toMatchObject({ name: 'run_command', arguments: { command: 'npm test' } })
  })

  it('reads bare JSON objects and string arguments', () => {
    const r = extractToolCalls('{"name":"edit_file","arguments":"{\\"path\\":\\"x.ts\\",\\"old_text\\":\\"a\\",\\"new_text\\":\\"b\\"}"}', tools)
    expect(r.calls[0].arguments).toEqual({ path: 'x.ts', old_text: 'a', new_text: 'b' })
  })

  it('ignores JSON that does not name a tool', () => {
    const text = 'Here is the config:\n```json\n{"name": "my-app", "version": "1.0.0"}\n```'
    const r = extractToolCalls(text, tools)
    expect(r.calls).toHaveLength(0)
    expect(r.rest).toBe(text)
  })
})
