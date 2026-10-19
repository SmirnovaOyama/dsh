import { describe, expect, it } from 'vitest'
import { contextWindow, currentModel, MODELS, modelInfo } from '../src/shared/types'

describe('models', () => {
  it('maps retired names to the model they point to now, keeping thinking on or off', () => {
    expect(currentModel('deepseek-chat', undefined)).toEqual({ model: 'deepseek-flash', effort: 'none' })
    expect(currentModel('deepseek-reasoner', undefined)).toEqual({ model: 'deepseek-flash', effort: 'high' })
    expect(currentModel('deepseek-v4-flash', 'low')).toEqual({ model: 'deepseek-flash', effort: 'low' })
  })

  it('keeps current names and fills in a missing or unknown effort', () => {
    expect(currentModel('deepseek-v4-pro', 'max')).toEqual({ model: 'deepseek-v4-pro', effort: 'max' })
    expect(currentModel('deepseek-flash', undefined)).toEqual({ model: 'deepseek-flash', effort: 'high' })
    expect(currentModel('deepseek-flash', 'medium' as never)).toEqual({ model: 'deepseek-flash', effort: 'high' })
  })

  it('knows the window of every model it offers', () => {
    for (const m of MODELS) expect(modelInfo(m)?.contextWindow).toBe(1_000_000)
    expect(contextWindow('something-else')).toBe(128_000)
  })
})
