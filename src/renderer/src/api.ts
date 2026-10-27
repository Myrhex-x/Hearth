export const api = window.hearth
export const isMac = api.platform === 'darwin'
export const isWin = api.platform === 'win32'

let seq = 0
export function uid(prefix = 'id'): string {
  seq = (seq + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
