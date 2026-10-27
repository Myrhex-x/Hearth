// Local models sometimes get stuck writing the same passage over and over.

/** True when the end of the text has already appeared several times: a model caught in a loop. */
export function isLooping(text: string): boolean {
  if (text.length < 2400) return false
  const tail = text.slice(-180)
  let count = 0
  let at = text.indexOf(tail)
  while (at >= 0) {
    count++
    if (count >= 4) return true
    at = text.indexOf(tail, at + 1)
  }
  return false
}
