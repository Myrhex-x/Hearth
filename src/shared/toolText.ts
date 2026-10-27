// Some local models (or their chat templates) print a tool call as text
// instead of returning a structured call. This recovers those calls so the
// agent keeps working, and returns the remaining prose.

import type { ToolCall } from './types'

export interface ExtractedCalls {
  calls: ToolCall[]
  rest: string
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))
    } catch {
      return undefined
    }
  }
}

function toCall(value: unknown, known: Set<string>, n: number): ToolCall | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const fn = (v.function && typeof v.function === 'object' ? v.function : v) as Record<string, unknown>
  const name = typeof fn.name === 'string' ? fn.name : typeof v.tool === 'string' ? (v.tool as string) : null
  if (!name || !known.has(name)) return null
  let args = fn.arguments ?? fn.parameters ?? v.arguments ?? v.parameters ?? v.args ?? {}
  if (typeof args === 'string') args = parseJsonLoose(args) ?? { _raw: args }
  if (!args || typeof args !== 'object') args = {}
  return { id: `text_call_${n}`, name, arguments: args as Record<string, unknown> }
}

/** Finds the end of a balanced JSON object starting at `start`. */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

export function extractToolCalls(text: string, toolNames: string[]): ExtractedCalls {
  const known = new Set(toolNames)
  const calls: ToolCall[] = []
  let rest = text

  // <tool_call>{...}</tool_call> (Qwen and Hermes templates)
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (whole, body: string) => {
    const call = toCall(parseJsonLoose(body.trim()), known, calls.length)
    if (call) {
      calls.push(call)
      return ''
    }
    return whole
  })
  if (calls.length) return { calls, rest: rest.trim() }

  // ```json {...} ``` fenced blocks naming a known tool
  rest = rest.replace(/```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)```/g, (whole, body: string) => {
    const trimmed = body.trim()
    if (!trimmed.startsWith('{')) return whole
    const call = toCall(parseJsonLoose(trimmed), known, calls.length)
    if (call) {
      calls.push(call)
      return ''
    }
    return whole
  })
  if (calls.length) return { calls, rest: rest.trim() }

  // Bare JSON objects in the text: {"name": "read_file", "arguments": {...}}
  let out = ''
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const end = objectEnd(text, open)
    if (end < 0) break
    const call = toCall(parseJsonLoose(text.slice(open, end)), known, calls.length)
    if (call) {
      calls.push(call)
      out += text.slice(i, open)
    } else out += text.slice(i, end)
    i = end
  }
  if (calls.length) return { calls, rest: (out + text.slice(i)).trim() }
  return { calls: [], rest: text }
}
