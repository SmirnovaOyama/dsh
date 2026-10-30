import { describe, expect, it } from 'vitest'
import { modelGroups, modelOptions } from '../src/renderer/models'
import { DEFAULT_SETTINGS, MODELS } from '../src/shared/types'

// Type-checked with the renderer (tsconfig.json), since the menus' words come from i18n beside the DOM code.

describe('model menus', () => {
  const settings = { ...DEFAULT_SETTINGS, opencodeModels: ['glm-5.3', 'kimi-k3'] }

  it("offers DeepSeek's models alone until there is an OpenCode key", () => {
    expect(modelGroups(settings, { deepseek: true, opencode: false }).map((g) => g.provider)).toEqual(['deepseek'])
    expect(modelGroups(settings, { deepseek: false, opencode: false }).map((g) => g.provider)).toEqual(['deepseek'])
  })

  it("offers each provider's models once it has a key", () => {
    const both = modelGroups(settings, { deepseek: true, opencode: true })
    expect(both.map((g) => [g.provider, g.label, g.models])).toEqual([
      ['deepseek', 'DeepSeek', [...MODELS]],
      ['opencode', 'OpenCode Go', ['opencode/glm-5.3', 'opencode/kimi-k3']],
    ])
    expect(modelGroups(settings, { deepseek: false, opencode: true }).map((g) => g.provider)).toEqual(['opencode'])
  })

  it('keeps the model in use in the list, even when its provider has no key any more', () => {
    const groups = modelGroups(settings, { deepseek: true, opencode: false }, 'opencode/qwen3.8-max')
    expect(groups.at(-1)).toMatchObject({ provider: 'opencode', models: ['opencode/qwen3.8-max'] })
  })

  it('says where an OpenCode model runs only when there is more than one provider', () => {
    const both = modelOptions(modelGroups(settings, { deepseek: true, opencode: true }), false)
    expect(both.find((o) => o.value === 'opencode/glm-5.3')).toEqual({ value: 'opencode/glm-5.3', label: 'glm-5.3', desc: 'OpenCode Go' })
    expect(both.find((o) => o.value === 'deepseek-flash')?.desc).toBeUndefined()
    const alone = modelOptions(modelGroups(settings, { deepseek: false, opencode: true }), true)
    expect(alone[0].desc).toBeUndefined()
  })
})
