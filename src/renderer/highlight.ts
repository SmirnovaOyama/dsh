// A small highlighter for code in answers: comments, strings, numbers and keywords.
// It is deliberately loose; it only needs to make code easier to scan.

export type Token = { kind: 'k' | 'c' | 's' | 'n' | null; text: string }

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger def default defer del delete do elif else enum ' +
    'except export extends false final finally fn for from func function go if impl implements import in instanceof interface ' +
    'is lambda let loop match mod module mut namespace new nil none not null of or and package pass private protected pub ' +
    'public raise readonly return self static struct super switch this throw throws true try type typeof undefined use var ' +
    'void where while with yield True False None echo then fi done esac local'
  ).split(' '),
)

const HASH_COMMENTS = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'shell', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'r', 'dockerfile', 'makefile', 'ini', 'conf'])
const NO_HIGHLIGHT = new Set(['text', 'txt', 'plain', 'diff', 'log', 'output', 'console', 'md', 'markdown'])

export function highlight(code: string, lang?: string): Token[] {
  const language = (lang ?? '').toLowerCase()
  if (NO_HIGHLIGHT.has(language) || code.length > 60_000) return [{ kind: null, text: code }]
  const hash = HASH_COMMENTS.has(language)
  const slash = !hash || language === 'php'
  const pattern = new RegExp(
    [
      slash ? String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` : null,
      hash ? String.raw`#[^\n]*` : null,
      String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\]|\\.)*\``,
      String.raw`\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-f]+\b`,
      String.raw`[A-Za-z_$][\w$]*`,
    ]
      .filter(Boolean)
      .join('|'),
    'gi',
  )
  const tokens: Token[] = []
  let last = 0
  for (const match of code.matchAll(pattern)) {
    const text = match[0]
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: null, text: code.slice(last, index) })
    const first = text[0]
    let kind: Token['kind'] = null
    if (text.startsWith('//') || text.startsWith('/*') || (hash && first === '#')) kind = 'c'
    else if (first === '"' || first === "'" || first === '`') kind = 's'
    else if (/\d/.test(first)) kind = 'n'
    else if (KEYWORDS.has(text)) kind = 'k'
    tokens.push({ kind, text })
    last = index + text.length
  }
  if (last < code.length) tokens.push({ kind: null, text: code.slice(last) })
  return tokens
}
