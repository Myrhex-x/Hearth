// Windows PowerShell 5.1 (the one every Windows install has) does not know
// "&&" or "||", but local models write them constantly. This rewrites those
// chains into PowerShell that behaves the same: stop at the first failure.

interface Piece {
  op: '&&' | '||' | null
  text: string
}

/** Splits on && and || outside quotes. Returns null when there is nothing to split. */
function splitChain(command: string): Piece[] | null {
  const pieces: Piece[] = []
  let quote: string | null = null
  let start = 0
  let op: Piece['op'] = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === '`' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      pieces.push({ op, text: command.slice(start, i).trim() })
      op = pair
      start = i + 2
      i++
    }
  }
  if (!pieces.length) return null
  pieces.push({ op, text: command.slice(start).trim() })
  if (pieces.some((p) => !p.text)) return null
  return pieces
}

export function adaptForWindowsPowerShell(command: string): string {
  const pieces = splitChain(command)
  if (!pieces) return command
  let out = pieces[pieces.length - 1].text
  for (let i = pieces.length - 1; i > 0; i--) {
    const cond = pieces[i].op === '&&' ? '$?' : '-not $?'
    out = `${pieces[i - 1].text}; if (${cond}) { ${out} }`
  }
  return out
}
