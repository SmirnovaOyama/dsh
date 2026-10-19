import { modelInfo, type Effort } from '../shared/types'
import { formatTokens } from './format'
import { t } from './i18n'

/** "V4.1 Flash", or the id itself for a model the app does not know. */
export function modelShort(model: string): string {
  return modelInfo(model)?.short ?? model
}

/** "DeepSeek V4.1 Flash" */
export function modelName(model: string): string {
  return modelInfo(model)?.name ?? model
}

/** "DeepSeek-V4.1-Flash-1017，上下文 1M" */
export function modelDesc(model: string): string | undefined {
  const info = modelInfo(model)
  return info ? t('model.desc', { version: info.version, window: formatTokens(info.contextWindow) }) : undefined
}

/** "思考 高", or "不思考" when thinking is off. */
export function effortShort(effort: Effort): string {
  return effort === 'none' ? t('effort.buttonOff') : t('effort.button', { level: t(`effort.${effort}`) })
}
