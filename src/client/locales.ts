/** Localized copy for the Grok Plugin configuration card. */

/** English Grok configuration copy. */
export const en = {
  title: 'Grok',
  description: 'Sign in with an xAI subscription. This plugin does not use a console API key.',
  expand: 'Expand settings',
  collapse: 'Collapse settings',
  signedOut: 'Not signed in.',
  signIn: 'Sign in with xAI',
  models: 'Model catalog',
  thinking: 'Reasoning',
  vision: 'Vision',
} as const

/** Locale keys owned by the Grok configuration card. */
export type GrokSettingsKey = keyof typeof en

/** Chinese Grok configuration copy. */
export const zh: Record<GrokSettingsKey, string> = {
  title: 'Grok',
  description: '使用 xAI 订阅登录。本插件不使用 console API key。',
  expand: '展开设置',
  collapse: '折叠设置',
  signedOut: '尚未登录。',
  signIn: '用 xAI 登录',
  models: '模型目录',
  thinking: '推理',
  vision: '视觉',
}
