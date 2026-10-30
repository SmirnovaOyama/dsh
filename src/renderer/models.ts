import { apiModel, modelInfo, MODELS, opencodeModel, PROVIDERS, providerOf, type Effort, type KeyState, type OpenCodePlan, type Provider, type Settings } from '../shared/types'
import { formatTokens } from './format'
import { t } from './i18n'

/** "V4.1 Flash", or the id itself, as its provider names it, for a model the app does not know. */
export function modelShort(model: string): string {
  return modelInfo(model)?.short ?? apiModel(model)
}

/** "DeepSeek V4.1 Flash" */
export function modelName(model: string): string {
  return modelInfo(model)?.name ?? apiModel(model)
}

/** "DeepSeek-V4.1-Flash-1017　上下文 1M": a wide space, not a comma, keeps the two facts apart at small sizes. */
export function modelDesc(model: string): string | undefined {
  const info = modelInfo(model)
  return info ? t('model.desc', { version: info.version, window: formatTokens(info.contextWindow) }) : undefined
}

/** "思考 高", or "不思考" when thinking is off. */
export function effortShort(effort: Effort): string {
  return effort === 'none' ? t('effort.buttonOff') : t('effort.button', { level: t(`effort.${effort}`) })
}

/** The thinking switches are DeepSeek's own; a model on OpenCode thinks the way it does by default. */
export function usesEffort(model: string): boolean {
  return providerOf(model) === 'deepseek'
}

/** "DeepSeek", "OpenCode Go" */
export function providerName(provider: Provider, plan: OpenCodePlan): string {
  return provider === 'deepseek' ? t('provider.deepseek') : t(`provider.opencode.${plan}`)
}

export interface ModelGroup {
  provider: Provider
  label: string
  models: string[]
}

/**
 * The models a menu offers, by provider: each provider with a key, DeepSeek's when there is none yet,
 * and always the model in use, so it stays checked.
 */
export function modelGroups(settings: Settings, keys: KeyState, current?: string): ModelGroup[] {
  const lists: Record<Provider, string[]> = {
    deepseek: keys.deepseek || !keys.opencode ? [...MODELS] : [],
    opencode: keys.opencode ? settings.opencodeModels.map(opencodeModel) : [],
  }
  if (current && !lists[providerOf(current)].includes(current)) lists[providerOf(current)].push(current)
  return PROVIDERS.filter((p) => lists[p].length).map((provider) => ({ provider, label: providerName(provider, settings.opencodePlan), models: lists[provider] }))
}

/** The same models as one list for a select. With more than one provider, each OpenCode model says where it runs. */
export function modelOptions(groups: ModelGroup[], details: boolean): { value: string; label: string; desc?: string }[] {
  return groups.flatMap((group) =>
    group.models.map((m) => ({
      value: m,
      label: modelName(m),
      desc: group.provider === 'deepseek' ? (details ? modelDesc(m) : undefined) : groups.length > 1 ? group.label : undefined,
    })),
  )
}
