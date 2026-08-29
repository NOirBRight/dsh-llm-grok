/** Browser half: Grok setup inside Plugin configuration. */

import type { ClientContext, SettingsScopeSnapshot } from './shim.js'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  GROK_AUTH_COMPLETE_ENDPOINT,
  GROK_AUTH_CANCEL_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_AUTH_ATTEMPT_STATUS_ENDPOINT,
  GROK_RPC_CHANNEL,
  GROK_MODELS_ENDPOINT,
  GROK_SAVE_ENDPOINT,
  GROK_SETTINGS_READ_ENDPOINT,
  GROK_PROVIDER,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthLogoutReply,
  decodeGrokAuthStartReply,
  decodeGrokAuthStatus,
  decodeGrokAuthAttemptStatus,
  decodeGrokModelsReply,
  decodeGrokSaveResult,
  decodeGrokSettingsReadResult,
  decodeGrokUsageReply,
} from '../client-contract.ts'
import type { GrokSettingsView } from '../client-contract.ts'
import { ensureProviderSection } from 'dsh-llm-providers-ui/client'
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
export const inject = ['slots', 'locale', 'connection']

/** Register localized Grok configuration under Plugin configuration. */

export function apply(ctx: ClientContext): void {
  const localeNamespace = 'settings.grok'
  ctx.effect(
    () => ctx.locale.register(localeNamespace, { zh, en }),
    'dsh-llm-grok: Plugin configuration copy',
  )
  const t = ctx.locale.bind(localeNamespace) as GrokPluginCardFace['t']
  const picker = new GrokModelPickerController()
  const { rpc } = ctx.get('connection') as unknown as ConnectionHandle
  let currentSnapshot: SettingsScopeSnapshot<GrokSettingsView> = {
    status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => currentSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: async () => { throw new Error('Use Grok management settings/save') },
    unset: async () => { throw new Error('Use Grok management settings/save') },
  }
  const publishSettings = (settings: GrokSettingsView, revision: number): void => {
    currentSnapshot = { ...currentSnapshot, status: 'ready', value: settings, revision }
    listeners.forEach(listener => listener())
  }
  const refreshSettings = async (): Promise<void> => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_SETTINGS_READ_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokSettingsReadResult(result.value)
    if (decoded === undefined) throw new Error('invalid Grok settings/read response')
    publishSettings(decoded.settings, decoded.revision)
  }
  void refreshSettings().catch(() => {
    currentSnapshot = { ...currentSnapshot, status: 'unavailable' }
    listeners.forEach(listener => listener())
  })

  const startAuth: GrokPluginCardFace['startAuth'] = async () => {
    const popup = typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
    if (popup !== null) popup.opener = null
    const closePopup = (): void => {
      if (popup !== null && !popup.closed) popup.close()
    }
    try {
      const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_START_ENDPOINT, {})
      if (!result.ok) {
        closePopup()
        return { ok: false, retryable: true, message: result.error.message }
      }
      const decoded = decodeGrokAuthStartReply(result.value)
      if (decoded === undefined) {
        closePopup()
        return { ok: false, retryable: true, message: t('signInFailed') }
      }
      if (decoded.ok && decoded.authorizationUrl) {
        if (popup !== null && !popup.closed) popup.location.href = decoded.authorizationUrl
        else return { ...decoded, popupBlocked: true }
      }
      return decoded
    } catch {
      closePopup()
      return { ok: false, retryable: true, message: t('signInFailed') }
    }
  }

  const completeAuth: GrokPluginCardFace['completeAuth'] = async (code, attemptId) => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_COMPLETE_ENDPOINT, { code, ...attemptId === undefined ? {} : { attemptId } })
    if (!result.ok) return { ok: false, retryable: true, message: result.error.message }
    const decoded = decodeGrokAuthStartReply(result.value)
    if (decoded === undefined) return { ok: false, retryable: true, message: t('signInFailed') }
    return decoded
  }

  const readAuthAttemptStatus: GrokPluginCardFace['readAuthAttemptStatus'] = async (attemptId) => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_ATTEMPT_STATUS_ENDPOINT, { attemptId })
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokAuthAttemptStatus(result.value)
    if (decoded === undefined) throw new Error(t('statusFailed'))
    return decoded
  }

  const cancelAuth: GrokPluginCardFace['cancelAuth'] = async (attemptId) => {
    const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_CANCEL_ENDPOINT, { attemptId })
    if (!result.ok) throw new Error(result.error.message)
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
      enableImageGen: settings.enableImageGen,
      expectedRevision: snapshot.revision,
    })
    if (!saved.ok) throw new Error(saved.error.message)
    const accepted = decodeGrokSaveResult(saved.value)
    if (accepted === undefined) throw new Error(t('requestFailed'))
    publishSettings(accepted.settings, accepted.revision)
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
    provider: GROK_PROVIDER,
    locale: localeNamespace,
    inject: (): GrokPluginCardFace => ({
      t,
      hooks: { grokSettings: scope },
      startAuth,
      completeAuth,
      cancelAuth,
      readAuthStatus,
       readAuthAttemptStatus,
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
