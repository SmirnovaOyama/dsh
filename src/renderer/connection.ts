// What Settings › Connection says about each provider's key.

import type { ConnectionResult, ErrorCode, Provider } from '../shared/types'
import { t, type MessageKey } from './i18n'

/** Nothing checked yet, a check on its way, or how the last one went. `rejected` means a new key was turned down and not kept. */
export type KeyCheck = { state: 'idle' } | { state: 'checking' } | { state: 'done'; result: ConnectionResult; rejected: boolean }

/** The links beside a provider's row. */
export type KeyAction = 'add' | 'replace' | 'retry' | 'remove'

const PASSING: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['network', 'server', 'rate', 'unknown'])

/**
 * The sentence under a provider's name. `key` is the saved key, masked, so the sentence says which one it is.
 * A check shows its waiting words only once it is slow.
 */
export function keyStatus(
  provider: Provider,
  hasKey: boolean,
  check: KeyCheck,
  { slow, encrypted, key }: { slow: boolean; encrypted: boolean; key: string | null },
): { text: string; problem: boolean } {
  if (!hasKey) return { text: t(`settings.keyNone.${provider}`), problem: false }
  const name = t(`provider.${provider}`)
  const shown = key ?? t('settings.yourKey')
  if (check.state === 'checking' && slow) return { text: t('settings.checking', { key: shown }), problem: false }
  if (check.state !== 'done') return { text: shown, problem: false }
  const { result } = check
  if (result.ok) {
    if (!encrypted) return { text: t('settings.connectedPlain', { key: shown }), problem: false }
    const text = result.models === undefined ? t('settings.connected', { key: shown }) : t('settings.connectedModels', { key: shown, n: result.models })
    return { text, problem: false }
  }
  if (result.error === 'auth') return { text: t('settings.rejectedSaved', { provider: name, key: shown }), problem: true }
  return { text: t(`error.${result.error ?? 'unknown'}.title` as MessageKey, { provider: name }), problem: true }
}

/** The line under a key being pasted: nothing until a check is slow, then why the key was turned down. */
export function attemptStatus(provider: Provider, attempt: KeyCheck, { slow }: { slow: boolean }): { text: string; problem: boolean } | null {
  if (attempt.state === 'checking') return slow ? { text: t('settings.checkingNew'), problem: false } : null
  if (attempt.state === 'done' && attempt.rejected) return { text: t('settings.rejected', { provider: t(`provider.${provider}`) }), problem: true }
  return null
}

/** A trouble that may pass gets a way to check again; otherwise a saved key can be replaced. Either way it can go. */
export function keyActions(hasKey: boolean, check: KeyCheck): KeyAction[] {
  if (!hasKey) return ['add']
  if (check.state === 'done' && check.result.error && PASSING.has(check.result.error)) return ['retry', 'remove']
  return ['replace', 'remove']
}

/** "oc_…7Tam": enough of the saved key to tell which one it is. */
export function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '…'
}
