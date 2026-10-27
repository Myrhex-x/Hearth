import { memo, useEffect, useMemo, useRef } from 'react'
import { marked, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api'
import { monaco } from '../lib/monaco'
import { editorHost } from '../state/editor'
import { toast } from '../state/ui'

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
  'c++': 'cpp',
  kt: 'kotlin',
  rb: 'ruby',
  golang: 'go',
  jsonc: 'json',
  toml: 'ini',
  vue: 'html',
  svelte: 'html'
}

function resolveLanguage(lang: string): string {
  const l = lang.toLowerCase().trim()
  if (!l) return 'plaintext'
  if (ALIASES[l]) return ALIASES[l]
  const known = monaco.languages.getLanguages()
  const hit = known.find((x) => x.id === l || x.aliases?.some((a) => a.toLowerCase() === l) || x.extensions?.includes('.' + l))
  return hit?.id ?? 'plaintext'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang ?? '').split(/\s/)[0]
      return `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${escapeHtml(lang || 'text')}</span><span class="md-code-actions"><button type="button" data-action="insert">Insert</button><button type="button" data-action="copy">Copy</button></span></div><pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(token.text)}</code></pre></div>`
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens)
      return `<a href="${escapeHtml(token.href)}" data-external="1">${text}</a>`
    }
  }
})

function render(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-action', 'data-lang', 'data-external'], FORBID_TAGS: ['style', 'iframe', 'form', 'input'] })
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => render(text), [text])

  useEffect(() => {
    if (streaming || !ref.current) return
    const blocks = ref.current.querySelectorAll<HTMLElement>('code[data-lang]')
    blocks.forEach((code) => {
      if (code.dataset.colored) return
      code.dataset.colored = '1'
      const source = code.textContent ?? ''
      const lang = resolveLanguage(code.dataset.lang ?? '')
      if (lang === 'plaintext' || source.length > 60000) return
      monaco.editor
        .colorize(source, lang, { tabSize: 2 })
        .then((colored) => {
          if (code.isConnected) code.innerHTML = DOMPurify.sanitize(colored)
        })
        .catch(() => {})
    })
  }, [html, streaming])

  return (
    <div
      ref={ref}
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const target = e.target as HTMLElement
        const link = target.closest('a[data-external]') as HTMLAnchorElement | null
        if (link) {
          e.preventDefault()
          api.app.openExternal(link.getAttribute('href') ?? '')
          return
        }
        const btn = target.closest('button[data-action]') as HTMLButtonElement | null
        if (!btn) return
        const code = btn.closest('.md-code')?.querySelector('pre')?.textContent ?? ''
        if (btn.dataset.action === 'copy') {
          void navigator.clipboard.writeText(code)
          btn.textContent = 'Copied'
          setTimeout(() => (btn.textContent = 'Copy'), 1400)
        } else if (btn.dataset.action === 'insert') {
          const ed = editorHost.editor
          const sel = ed?.getSelection()
          if (!ed || !sel || !ed.getModel()) {
            toast('Open a file first to insert code into it.')
            return
          }
          ed.executeEdits('hearth.insert', [{ range: sel, text: code, forceMoveMarkers: true }])
          ed.pushUndoStop()
          ed.focus()
        }
      }}
    />
  )
})
