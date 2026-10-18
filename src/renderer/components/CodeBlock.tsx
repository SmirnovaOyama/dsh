import { Check, Copy } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { highlight } from '../highlight'
import { t } from '../i18n'
import { Icon } from './Icon'

export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang])
  return (
    <div className="hx-code">
      <div className="bar">
        <span>{lang || 'text'}</span>
        <CopyButton text={code} />
      </div>
      <pre>
        <code>
          {tokens.map((token, i) => (token.kind ? <span key={i} className={`tok-${token.kind}`}>{token.text}</span> : token.text))}
        </code>
      </pre>
    </div>
  )
})

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className="btn-ghost hx-icon-btn hx-copy"
      aria-label={copied ? t('copy.done') : t('copy.label')}
      title={copied ? t('copy.done') : t('copy.label')}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      <span className="copy-glyph" data-hidden={copied} style={{ display: 'grid', placeItems: 'center' }}>
        <Icon icon={Copy} size={16} />
      </span>
      <span className="tick-draw" data-on={copied} style={{ display: 'grid', placeItems: 'center' }}>
        <Icon icon={Check} size={16} />
      </span>
    </button>
  )
}

/** Plain monospace output such as command results; no language bar. */
export function OutputBlock({ text, wrap }: { text: string; wrap?: boolean }) {
  return (
    <div className="hx-code hx-output">
      <pre className={`is-plain ${wrap ? 'is-wrap' : ''}`}>{text}</pre>
    </div>
  )
}
