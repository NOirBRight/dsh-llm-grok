/** Browser half: Grok setup inside Plugin configuration. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_RPC_CHANNEL,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthLogoutReply,
  decodeGrokAuthStartReply,
  decodeGrokAuthStatus,
  decodeGrokUsageReply,
} from '../client-contract.ts'
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
export const inject = ['slots', 'locale', 'connection']

/** Register localized Grok configuration under Plugin configuration. */
export function apply(ctx: ClientContext): void {
  const localeNamespace = 'settings.grok'
  ctx.effect(
    () => ctx.locale.register(localeNamespace, { zh, en }),
    'dsh-llm-grok: Plugin configuration copy',
  )
  const t = ctx.locale.bind(localeNamespace) as GrokPluginCardFace['t']
  const { rpc } = ctx.get('connection') as unknown as ConnectionHandle

  const startAuth: GrokPluginCardFace['startAuth'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_START_ENDPOINT, {})
    if (!result.ok) return { ok: false, retryable: true, message: result.error.message }
    const decoded = decodeGrokAuthStartReply(result.value)
    if (decoded === undefined) return { ok: false, retryable: true, message: t('signInFailed') }
    return decoded
  }

  const readAuthStatus: GrokPluginCardFace['readAuthStatus'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_STATUS_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokAuthStatus(result.value)
    if (decoded === undefined) throw new Error(t('statusFailed'))
    return decoded
  }

  const logout: GrokPluginCardFace['logout'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_LOGOUT_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    if (decodeGrokAuthLogoutReply(result.value) === undefined) throw new Error(t('signOutFailed'))
  }

  const fetchUsage: GrokPluginCardFace['fetchUsage'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_USAGE_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokUsageReply(result.value)
    if (decoded === undefined) throw new Error(t('usageFailed'))
    return decoded
  }

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'grok',
    order: 40,
    locale: localeNamespace,
    inject: (): GrokPluginCardFace => ({ t, startAuth, readAuthStatus, logout, fetchUsage }),
  }, GrokPluginCard))
}
