import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { coal, paper } from './themes'
import { basename, extname } from './paths'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

monaco.editor.defineTheme('hearth-coal', coal)
monaco.editor.defineTheme('hearth-paper', paper)

// The editor shows one file at a time, so the TypeScript service should not
// complain about imports it cannot resolve.
const tsDefaults = {
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true
}
const compilerOptions = {
  target: 99,
  module: 99,
  moduleResolution: 100,
  jsx: 4,
  allowJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  skipLibCheck: true
}
try {
  const ts = (monaco as unknown as { typescript?: { typescriptDefaults: { setDiagnosticsOptions(o: unknown): void; setCompilerOptions(o: unknown): void }; javascriptDefaults: { setDiagnosticsOptions(o: unknown): void; setCompilerOptions(o: unknown): void } } }).typescript
  ts?.typescriptDefaults.setDiagnosticsOptions(tsDefaults)
  ts?.javascriptDefaults.setDiagnosticsOptions(tsDefaults)
  ts?.typescriptDefaults.setCompilerOptions(compilerOptions)
  ts?.javascriptDefaults.setCompilerOptions(compilerOptions)
} catch {
  // language service shape changed; diagnostics keep their defaults
}

export { monaco }

const SPECIAL_NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
  '.gitignore': 'shell',
  '.env': 'shell',
  '.zshrc': 'shell',
  '.bashrc': 'shell',
  'cmakelists.txt': 'cpp'
}

let extMap: Map<string, string> | null = null

export function languageFor(path: string): string {
  const name = basename(path).toLowerCase()
  if (SPECIAL_NAMES[name]) return SPECIAL_NAMES[name]
  if (name.startsWith('.env')) return 'shell'
  if (!extMap) {
    extMap = new Map()
    for (const lang of monaco.languages.getLanguages()) {
      for (const ext of lang.extensions ?? []) if (!extMap.has(ext.toLowerCase())) extMap.set(ext.toLowerCase(), lang.id)
    }
    extMap.set('.mdx', 'markdown')
    extMap.set('.mjs', 'javascript')
    extMap.set('.cjs', 'javascript')
    extMap.set('.mts', 'typescript')
    extMap.set('.cts', 'typescript')
    extMap.set('.vue', 'html')
    extMap.set('.svelte', 'html')
    extMap.set('.astro', 'html')
    extMap.set('.toml', 'ini')
    extMap.set('.jsonc', 'json')
    extMap.set('.gradle', 'java')
    extMap.set('.zig', 'rust')
  }
  return extMap.get(extname(path)) ?? 'plaintext'
}

export function languageLabel(id: string): string {
  const lang = monaco.languages.getLanguages().find((l) => l.id === id)
  return lang?.aliases?.[0] ?? id
}

export function themeName(dark: boolean): string {
  return dark ? 'hearth-coal' : 'hearth-paper'
}

export function uriFor(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'file', path: '/' + path })
}
