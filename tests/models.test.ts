import { describe, expect, it } from 'vitest'
import { apiModel, contextWindow, currentModel, defaultOpenCodeModel, MODELS, modelInfo, opencodeModel, providerOf, usableOpenCodeModel } from '../src/shared/types'

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

describe('OpenCode models', () => {
  it('names them the way OpenCode does and sends the bare id', () => {
    expect(opencodeModel('glm-5.3')).toBe('opencode/glm-5.3')
    expect(providerOf('opencode/glm-5.3')).toBe('opencode')
    expect(apiModel('opencode/glm-5.3')).toBe('glm-5.3')
    expect(providerOf('deepseek-flash')).toBe('deepseek')
    expect(apiModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  it("gives DeepSeek's models on OpenCode their own window and others the smallest", () => {
    expect(contextWindow('opencode/deepseek-v4.1-flash')).toBe(1_000_000)
    expect(contextWindow('opencode/deepseek-v4-pro')).toBe(1_000_000)
    expect(contextWindow('opencode/glm-5.3')).toBe(128_000)
  })

  it('leaves out the free models only OpenCode itself can use', () => {
    expect(['big-pickle', 'glm-5.3-flash-free', 'glm-5.3', 'kimi-k3'].filter(usableOpenCodeModel)).toEqual(['glm-5.3', 'kimi-k3'])
  })

  it("starts on DeepSeek's own default when the plan has it", () => {
    expect(defaultOpenCodeModel(['glm-5.3', 'deepseek-v4.1-flash'])).toBe('opencode/deepseek-v4.1-flash')
    expect(defaultOpenCodeModel(['glm-5.3', 'kimi-k3'])).toBe('opencode/glm-5.3')
    expect(defaultOpenCodeModel([])).toBeNull()
  })
})
