/** Browser half: Grok setup inside Plugin configuration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from 'dsh-llm-providers-ui/client'
import { createGrokUsageReader, dropPersistedUsageKeys } from 'dsh-llm-providers-ui/usage-readers'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Register this card, its shared header ownership, quota reader, display name,
 * and active model count so the shared settings page needs no DOM probing.
 * @param ctx - client context carrying the Provider directory.
 * @param modelCount - reads the current active model count from plugin state.
 */
function installProviderDirectory(
  ctx: ClientContext,
  modelCount: () => number | undefined,
  extras: { catalogId: string, account: () => { state: 'connected' | 'configured' | 'unconnected' | 'unknown' } },
): void {
  ctx.inject(['providerDirectory'], scope => {
    scope.effect(() => {
      const declaration = Object.assign({
        key: GROK_SETTINGS_NAMESPACE,
        name: 'Grok',
        header: 'shared' as const,
        detail: 'shared' as const,
        usage: createGrokUsageReader(),
        modelCount,
      }, {
        catalogId: extras.catalogId,
        account: extras.account,
      })
      return scope.providerDirectory.register(declaration as Parameters<typeof scope.providerDirectory.register>[0])
    }, 'dsh-llm-grok: provider directory registration')
  })
}

import {
  GROK_AUTH_COMPLETE_ENDPOINT,
  GROK_AUTH_CANCEL_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_AUTH_ATTEMPT_STATUS_ENDPOINT,
  GROK_RPC_METHOD,
  GROK_MODELS_ENDPOINT,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthLogoutReply,
  decodeGrokAuthStartReply,
  decodeGrokAuthStatus,
  decodeGrokAuthAttemptStatus,
  decodeGrokModelsReply,
  decodeGrokUsageReply,
} from '../client-contract.ts'
import type { GrokSettingsForm } from '../client-contract.ts'
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
export const inject = ['slots', 'locale', 'connection', 'configForms']

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
  const settingsForm: ConfigForm<GrokSettingsForm> = ctx.configForms.get<GrokSettingsForm>(GROK_SETTINGS_NAMESPACE)
  const callGrokRpc = (endpoint: string, payload: unknown, signal?: AbortSignal) =>
    rpc.call('/api', GROK_RPC_METHOD, { endpoint, payload }, signal)
  // The shared ConfigForm owns the snapshot and Provider directory updates.
  const account = { state: 'unknown' as 'connected' | 'configured' | 'unconnected' | 'unknown' }
  let closed = false
  const publishAccount = (state: typeof account.state): void => {
    if (closed || account.state === state) return
    account.state = state
    try { ctx.get('providerDirectory')?.update(GROK_SETTINGS_NAMESPACE) } catch { /* providerDirectory is optional in lab */ }
  }
  installProviderDirectory(ctx, () => settingsForm.getSnapshot().value?.models?.length, {
    catalogId: 'grok',
    account: () => ({ state: account.state }),
  })
  ctx.effect(() => settingsForm.subscribe(() => {
    try { ctx.get('providerDirectory')?.update(GROK_SETTINGS_NAMESPACE) } catch { /* providerDirectory is optional in lab */ }
  }), 'dsh-llm-grok: update provider model count')


  const startAuth: GrokPluginCardFace['startAuth'] = async () => {
    const popup = typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
    if (popup !== null) popup.opener = null
    const closePopup = (): void => {
      if (popup !== null && !popup.closed) popup.close()
    }
    try {
      const result = await callGrokRpc(GROK_AUTH_START_ENDPOINT, {})
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

  let authGeneration = 0
  /** Purge every bundle copy, even without providerDirectory. Stale reads check currency first. */
  const invalidateUsageCache = (): void => {
    dropPersistedUsageKeys([GROK_SETTINGS_NAMESPACE])
    try { ctx.get('providerDirectory')?.invalidateUsage(GROK_SETTINGS_NAMESPACE) } catch { /* providerDirectory is optional in lab */ }
  }

  const completeAuth: GrokPluginCardFace['completeAuth'] = async (code, attemptId) => {
    const result = await callGrokRpc(GROK_AUTH_COMPLETE_ENDPOINT, { code, ...attemptId === undefined ? {} : { attemptId } })
    if (!result.ok) return { ok: false, retryable: true, message: result.error.message }
    const decoded = decodeGrokAuthStartReply(result.value)
    if (decoded === undefined) return { ok: false, retryable: true, message: t('signInFailed') }
    if (decoded.ok === true) {
      authGeneration += 1
      invalidateUsageCache()
      publishAccount('connected')
    }
    return decoded
  }

  const readAuthAttemptStatus: GrokPluginCardFace['readAuthAttemptStatus'] = async (attemptId) => {
    const generation = authGeneration
    const result = await callGrokRpc(GROK_AUTH_ATTEMPT_STATUS_ENDPOINT, { attemptId })
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokAuthAttemptStatus(result.value)
    if (decoded === undefined) throw new Error(t('statusFailed'))
    if (generation !== authGeneration || closed) return decoded
    if (decoded.state === 'succeeded') {
      authGeneration += 1
      invalidateUsageCache()
      publishAccount('connected')
    }
    return decoded
  }

  const cancelAuth: GrokPluginCardFace['cancelAuth'] = async (attemptId) => {
    const result = await callGrokRpc(GROK_AUTH_CANCEL_ENDPOINT, { attemptId })
    if (!result.ok) throw new Error(result.error.message)
  }

  const readAuthStatus: GrokPluginCardFace['readAuthStatus'] = async () => {
    const generation = authGeneration
    const result = await callGrokRpc(GROK_AUTH_STATUS_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokAuthStatus(result.value)
    if (decoded === undefined) throw new Error(t('statusFailed'))
    if (generation !== authGeneration || closed) return decoded
    if (decoded.loggedIn === false) invalidateUsageCache()
    publishAccount(decoded.loggedIn === true ? 'connected' : 'unconnected')
    return decoded
  }

  const logout: GrokPluginCardFace['logout'] = async () => {
    const result = await callGrokRpc(GROK_AUTH_LOGOUT_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    if (decodeGrokAuthLogoutReply(result.value) === undefined) throw new Error(t('signOutFailed'))
    authGeneration += 1
    invalidateUsageCache()
    publishAccount('unconnected')
  }

  const fetchModels: GrokPluginCardFace['fetchModels'] = async () => {
    const result = await callGrokRpc(GROK_MODELS_ENDPOINT, {})
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeGrokModelsReply(result.value)
    if (decoded === undefined) throw new Error(t('statusFailed'))
    return decoded.models
  }

  const fetchUsage: GrokPluginCardFace['fetchUsage'] = async () => {
    const generation = authGeneration
    const result = await callGrokRpc(GROK_USAGE_ENDPOINT, {})
    if (!result.ok) {
      // Wire code is dropped by the Error below; purge here so a refused credential
      // cannot keep painting the previous account's quota in every bundle copy.
      if (result.error.code === 'INVALID_CREDENTIAL') dropPersistedUsageKeys([GROK_SETTINGS_NAMESPACE])
      throw new Error(result.error.message)
    }
    const decoded = decodeGrokUsageReply(result.value)
    if (decoded === undefined) throw new Error(t('usageFailed'))
    if (decoded.status === 'logged-out' && generation === authGeneration) invalidateUsageCache()
    return decoded
  }

  const saveConfiguration: GrokPluginCardFace['saveConfiguration'] = async (settings, expectedRevision) => {
    const models = JSON.parse(JSON.stringify(settings.models)) as JsonValue
    const accepted = await settingsForm.mutate([
      { op: 'set', path: ['models'], value: models },
      { op: 'set', path: ['enableImageGen'], value: settings.enableImageGen },
    ], expectedRevision)
    if (!accepted) throw new Error(t('requestFailed'))
    const snapshot = settingsForm.getSnapshot()
    if (snapshot.value === undefined || snapshot.revision === undefined) throw new Error(t('requestFailed'))
    return { settings: snapshot.value, revision: snapshot.revision }
  }

  ctx.effect(() => {
    void readAuthStatus().catch(() => { /* overview stays unknown until a later card read */ })
    return () => { closed = true }
  }, 'dsh-llm-grok: account snapshot')

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
  ctx.slots.inject('settings.provider.item', () => ctx.slots.register({
    name: 'settings.provider.item',
    key: GROK_SETTINGS_NAMESPACE,
    locale: localeNamespace,
    inject: (): GrokPluginCardFace => ({
      t,
      hooks: { grokSettings: settingsForm },
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
