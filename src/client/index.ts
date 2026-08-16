/** Browser half: Grok setup inside Plugin configuration. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { GrokPluginCard } from './GrokPluginCard.tsx'
import type { GrokPluginCardFace } from './GrokPluginCard.tsx'
import { en, zh } from './locales.ts'
import type { GrokSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Grok Plugin configuration copy. */
    'settings.grok': GrokSettingsKey
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-llm-grok-client'
/** Client services required by the Plugin configuration contribution. */
export const inject = ['slots', 'locale']

/** Register localized Grok configuration under Plugin configuration. */
export function apply(ctx: ClientContext): void {
  const localeNamespace = 'settings.grok'
  ctx.effect(
    () => ctx.locale.register(localeNamespace, { zh, en }),
    'dsh-llm-grok: Plugin configuration copy',
  )
  const t = ctx.locale.bind(localeNamespace) as GrokPluginCardFace['t']

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'grok',
    order: 40,
    locale: localeNamespace,
    inject: (): GrokPluginCardFace => ({ t }),
  }, GrokPluginCard))
}
