import { Children, isValidElement, memo, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { CodeBlock } from './CodeBlock'

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

const components: Components = {
  pre({ children }) {
    const child = Children.toArray(children)[0] as ReactElement<{ className?: string; children?: ReactNode }> | undefined
    const lang = /language-([\w+#.-]+)/.exec(child?.props.className ?? '')?.[1]
    return <CodeBlock code={textOf(child?.props.children).replace(/\n$/, '')} lang={lang} />
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault()
          if (href && /^https?:\/\//.test(href)) void api.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="hx-table">
        <table>{children}</table>
      </div>
    )
  },
  img({ alt }) {
    // Answers never load remote images; show the description instead.
    return <span className="hx-muted">{alt}</span>
  },
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`hx-prose ${streaming ? 'is-streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
