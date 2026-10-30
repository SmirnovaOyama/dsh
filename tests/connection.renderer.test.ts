import { describe, expect, it } from 'vitest'
import { attemptStatus, keyActions, keyStatus, maskKey, type KeyCheck } from '../src/renderer/connection'

// Type-checked with the renderer (tsconfig.json), since the words come from i18n beside the DOM code.

const idle: KeyCheck = { state: 'idle' }
const checking: KeyCheck = { state: 'checking' }
const done = (result: Extract<KeyCheck, { state: 'done' }>['result'], rejected = false): KeyCheck => ({ state: 'done', result, rejected })
const saved = { slow: false, encrypted: true, key: 'oc_…7Tam' }

describe('the sentence under a provider', () => {
  it('says what a key would bring before there is one', () => {
    expect(keyStatus('deepseek', false, idle, saved)).toEqual({ text: '加入金鑰就能用 V4.1 Flash 和 V4 Pro', problem: false })
    expect(keyStatus('opencode', false, idle, saved).text).toBe('加入金鑰就能用 GLM、Kimi、Qwen 和更多模型')
  })

  it('names the saved key, and keeps quiet about a quick check', () => {
    expect(keyStatus('opencode', true, idle, saved).text).toBe('oc_…7Tam')
    expect(keyStatus('opencode', true, checking, saved).text).toBe('oc_…7Tam')
    expect(keyStatus('opencode', true, checking, { ...saved, slow: true }).text).toBe('正在檢查 oc_…7Tam')
    expect(keyStatus('opencode', true, idle, { ...saved, key: null }).text).toBe('你的金鑰')
  })

  it('says the key is connected, with the model count where the provider gives one', () => {
    expect(keyStatus('deepseek', true, done({ ok: true }), { ...saved, key: 'sk-…0a1b' })).toEqual({ text: 'sk-…0a1b 已連線', problem: false })
    expect(keyStatus('opencode', true, done({ ok: true, models: 26 }), saved).text).toBe('oc_…7Tam 已連線，可以用 26 個模型')
    expect(keyStatus('opencode', true, done({ ok: true }), { ...saved, encrypted: false }).text).toMatch(/一般文字/)
  })

  it('names the provider in every problem', () => {
    expect(keyStatus('opencode', true, done({ ok: false, error: 'auth' }), saved)).toEqual({ text: 'OpenCode 不再接受 oc_…7Tam', problem: true })
    expect(keyStatus('opencode', true, done({ ok: false, error: 'network' }), saved)).toEqual({ text: '連不上 OpenCode', problem: true })
    expect(keyStatus('deepseek', true, done({ ok: false, error: 'balance' }), saved).text).toBe('DeepSeek 帳戶餘額不足')
  })
})

describe('a key being pasted', () => {
  it('says nothing until the check is slow, then why the key was turned down', () => {
    expect(attemptStatus('deepseek', idle, { slow: false })).toBeNull()
    expect(attemptStatus('deepseek', checking, { slow: false })).toBeNull()
    expect(attemptStatus('deepseek', checking, { slow: true })).toEqual({ text: '正在檢查這把金鑰', problem: false })
    expect(attemptStatus('opencode', done({ ok: false, error: 'auth' }, true), { slow: false })).toEqual({ text: 'OpenCode 不接受這把金鑰', problem: true })
  })
})

describe('the links beside a provider', () => {
  it('adds a key, retries passing trouble, and otherwise replaces or removes the key', () => {
    expect(keyActions(false, idle)).toEqual(['add'])
    expect(keyActions(true, done({ ok: true }))).toEqual(['replace', 'remove'])
    expect(keyActions(true, done({ ok: false, error: 'network' }))).toEqual(['retry', 'remove'])
    expect(keyActions(true, done({ ok: false, error: 'auth' }))).toEqual(['replace', 'remove'])
  })

  it('shows only enough of a saved key to tell it apart', () => {
    expect(maskKey('oc_7d2e9b4a1c6f8e3dJ7Tam')).toBe('oc_…7Tam')
    expect(maskKey('short')).toBe('…')
  })
})
