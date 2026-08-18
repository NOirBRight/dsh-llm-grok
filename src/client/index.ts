/** Browser half: Grok setup inside Plugin configuration. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  GROK_AUTH_COMPLETE_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_RPC_CHANNEL,
  GROK_MODELS_ENDPOINT,
  GROK_SAVE_ENDPOINT,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthLogoutReply,
  decodeGrokAuthStartReply,
  decodeGrokAuthStatus,
  decodeGrokModelsReply,
  decodeGrokSaveResult,
  decodeGrokSettings,
  decodeGrokUsageReply,
} from '../client-contract.ts'
import type { GrokSettingsView } from '../client-contract.ts'
import { ensureProviderSection } from './provider-section.ts'
import { GrokPluginCard } from './GrokPluginCard.tsx'
import type { GrokPluginCardFace } from './GrokPluginCard.tsx'
import { GrokModelPicker, GrokModelPickerController } from './GrokModelPicker.tsx'
import type { GrokModelPickerFace } from './GrokModelPicker.tsx'
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
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/** Register localized Grok configuration under Plugin configuration. */
export function apply(ctx: ClientContext): void {
  const localeNamespace = 'settings.grok'
  ctx.effect(
    () => ctx.locale.register(localeNamespace, { zh, en }),
    'dsh-llm-grok: Plugin configuration copy',
  )
  const t = ctx.locale.bind(localeNamespace) as GrokPluginCardFace['t']
  const scope = ctx.settingsScope.bind<GrokSettingsView>({
    namespace: GROK_SETTINGS_NAMESPACE,
    decode: decodeGrokSettings,
  })
  const picker = new GrokModelPickerController()
  const { rpc } = ctx.get('connection') as unknown as ConnectionHandle

  const startAuth: GrokPluginCardFace['startAuth'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_START_ENDPOINT, {})
    if (!result.ok) return { ok: false, retryable: true, message: result.error.message }
    const decoded = decodeGrokAuthStartReply(result.value)
    if (decoded === undefined) return { ok: false, retryable: true, message: t('signInFailed') }
    return decoded
  }

  const completeAuth: GrokPluginCardFace['completeAuth'] = async (code) => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_COMPLETE_ENDPOINT, { code })
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

  const fetchModels: GrokPluginCardFace['fetchModels'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_MODELS_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokModelsReply(result.value)
    if (decoded === undefined) throw new Error(t('statusFailed'))
    return decoded.models
  }

  const fetchUsage: GrokPluginCardFace['fetchUsage'] = async () => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_USAGE_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokUsageReply(result.value)
    if (decoded === undefined) throw new Error(t('usageFailed'))
    return decoded
  }

  const saveConfiguration: GrokPluginCardFace['saveConfiguration'] = async (settings) => {
    const snapshot = scope.getSnapshot()
    if (snapshot.revision === undefined) throw new Error(t('requestFailed'))
    const saved = await rpc.call(GROK_RPC_CHANNEL, GROK_SAVE_ENDPOINT, {
      models: settings.models,
      expectedRevision: snapshot.revision,
    })
    if (!saved.ok) throw new Error(saved.error.message)
    const accepted = decodeGrokSaveResult(saved.value)
    if (accepted === undefined) throw new Error(t('requestFailed'))
    return accepted
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'grok-model-picker',
    order: 100,
    inject: (): GrokModelPickerFace => ({
      t,
      hooks: { grokModelPicker: picker },
      closePicker: picker.close,
      togglePickerModel: picker.toggle,
      adoptPickerModels: picker.adopt,
    }),
  }, GrokModelPicker))

  ensureProviderSection(ctx)
  ctx.slots.inject('settings.provider.item', () => ctx.slots.register({
    name: 'settings.provider.item',
    key: GROK_SETTINGS_NAMESPACE,
    locale: localeNamespace,
    inject: (): GrokPluginCardFace => ({
      t,
      hooks: { grokSettings: scope },
      startAuth,
      completeAuth,
      readAuthStatus,
      logout,
      fetchUsage,
      fetchModels,
      saveConfiguration,
      beginModelPicker: (initiallyPicked, onAdopt) => { picker.begin(onAdopt, initiallyPicked) },
      completeModelPicker: candidates => { picker.complete(candidates) },
      failModelPicker: message => { picker.fail(message) },
      closeModelPicker: picker.close,
    }),
  }, GrokPluginCard))
}
