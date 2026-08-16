/** Localized copy for the Grok Plugin configuration card. */

/** English Grok configuration copy. */
export const en = {
  title: 'Grok',
  description: 'Sign in with an xAI subscription. This plugin does not use a console API key.',
  expand: 'Expand settings',
  collapse: 'Collapse settings',
  signedOut: 'Not signed in.',
  signedInAs: 'Signed in as {email}.',
  signedInNoEmail: 'Signed in.',
  signIn: 'Sign in with xAI',
  signOut: 'Sign out',
  signingIn: 'Waiting for browser sign-in…',
  pasteCode: 'If the page asks you to copy a code into Grok Build, paste it here.',
  pasteCodeLabel: 'Sign-in code',
  pasteCodeSubmit: 'Submit code',
  pasteCodeEmpty: 'Paste the code from the browser page.',
  signInFailed: 'Sign-in did not complete. You can try again.',
  signOutFailed: 'Could not sign out. Try again.',
  statusFailed: 'Could not read sign-in status.',
  models: 'Model catalog',
  thinking: 'Reasoning',
  vision: 'Vision',
  usage: 'Subscription usage',
  usageRefresh: 'Refresh',
  usageLoading: 'Reading usage…',
  usageUsed: 'Used',
  usageUnsupported: 'This subscription does not report usage.',
  usageFailed: 'Could not read usage.',
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
  signedInAs: '已登录为 {email}。',
  signedInNoEmail: '已登录。',
  signIn: '用 xAI 登录',
  signOut: '退出登录',
  signingIn: '正在等待浏览器登录…',
  pasteCode: '如果页面要你把代码复制到 Grok Build，把它贴到这里。',
  pasteCodeLabel: '登录代码',
  pasteCodeSubmit: '提交代码',
  pasteCodeEmpty: '请粘贴浏览器页面上的代码。',
  signInFailed: '登录未完成。可以重试。',
  signOutFailed: '无法退出登录。请重试。',
  statusFailed: '无法读取登录状态。',
  models: '模型目录',
  thinking: '推理',
  vision: '视觉',
  usage: '订阅额度',
  usageRefresh: '刷新',
  usageLoading: '正在读取额度…',
  usageUsed: '已用',
  usageUnsupported: '此订阅不提供额度信息。',
  usageFailed: '无法读取额度。',
}
