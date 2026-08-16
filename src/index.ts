/**
 * Register the `grok` provider directory entry, the Responses chat adapter,
 * the `llm-grok` settings section, and the loopback `/grok` auth RPC. Billing
 * is not installed yet. The route is distinct from the built-in `xai`
 * console-key provider.
 * @module dsh-llm-grok
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { GrokAdapter, resolveGrokAccessToken } from './adapter.ts'
import type { GrokConnectionOptions } from './adapter.ts'
import {
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_RPC_CHANNEL,
  GROK_SETTINGS_NAMESPACE,
  decodeGrokEmptyRequest,
} from './client-contract.ts'
import { createGrokAuthRuntime, ensureFreshSession, startPkceLogin } from './oauth.ts'
import type { GrokOAuthRuntime } from './oauth.ts'
import { GROK_CHAT_BASE_URL } from './pi-ai-profile.ts'
import { deleteSession, resolveGrokSessionPath, statusFromSession } from './session.ts'

export { GrokAdapter, resolveGrokAccessToken } from './adapter.ts'
export type { GrokAdapterOptions, GrokConnectionOptions } from './adapter.ts'
export {
  GROK_CATALOG,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_SETTINGS_NAMESPACE,
  GROK_RPC_CHANNEL,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  decodeGrokSettings,
  decodeGrokAuthStatus,
  decodeGrokAuthStartReply,
  decodeGrokAuthLogoutReply,
  decodeGrokEmptyRequest,
} from './client-contract.ts'
export {
  GROK_CHAT_BASE_URL,
  GROK_DEFAULT_CONTEXT_WINDOW,
  GROK_DEFAULT_MODEL_MAX_TOKENS,
  GROK_PLUGIN_IDENTITY_HEADER,
  createGrokPiAiProfile,
} from './pi-ai-profile.ts'
export { GROK_SERVER_SEARCH_TOOLS, grokResponsesApi, injectGrokServerSearchTools } from './responses-tools.ts'
export type {
  GrokCatalogModel,
  GrokSettingsView,
  GrokAuthStatus,
  GrokAuthStartReply,
  GrokAuthLogoutReply,
} from './client-contract.ts'
export {
  GROK_OAUTH_ISSUER,
  GROK_OAUTH_CLIENT_ID,
  GROK_OAUTH_SCOPE,
  createGrokAuthRuntime,
  ensureFreshSession,
  refreshSession,
  startPkceLogin,
} from './oauth.ts'
export type { GrokOAuthRuntime, GrokOidcEndpoints } from './oauth.ts'
export {
  GROK_SESSION_FILENAME,
  resolveGrokSessionPath,
  sessionPathForHome,
  readSession,
  writeSession,
  deleteSession,
  statusFromSession,
} from './session.ts'
export type { GrokSession } from './session.ts'

export const name = 'llm-grok'
export const inject = ['llm']

const NS = settingsNamespace(GROK_SETTINGS_NAMESPACE)

/** One resolution's complete request facts. */
export type ResolvedGrokOptions = GrokConnectionOptions

/**
 * The one explicit resolve step from raw config to validated connection facts.
 * Catalog membership and the chat base URL are source constants.
 * @param config - raw plugin config or resolved settings snapshot.
 */
export function resolveAdapterOptions(config: Config): ResolvedGrokOptions {
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-grok: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return {
    baseURL: GROK_CHAT_BASE_URL,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-grok: retryPolicy'),
  }
}

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-grok` settings-section shape. There is no `apiKeyEnv`: this
 * provider authenticates with an xAI subscription, not a console API key.
 */
export interface Config {
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

export const Config: z<Config> = z.object({
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(
    GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  ),
  retryPolicy: RetryPolicySchema,
})

function internalError(message: string) {
  return {
    ok: false as const,
    error: {
      code: 'internal' as const,
      message,
      details: {},
    },
  }
}

/**
 * Loopback `/grok` handler. Status and start replies never include tokens.
 * @param runtime - Host OAuth runtime (production or a test fake).
 */
export function createGrokRpcHandler(runtime: GrokOAuthRuntime): ConnectionRpcHandler {
  return async (endpoint, payload, signal) => {
    if (endpoint === GROK_AUTH_START_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok auth start request')
      return { ok: true as const, value: await startPkceLogin(runtime, signal) }
    }
    if (endpoint === GROK_AUTH_STATUS_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok auth status request')
      const session = await ensureFreshSession(runtime)
      return { ok: true as const, value: statusFromSession(session) }
    }
    if (endpoint === GROK_AUTH_LOGOUT_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok auth logout request')
      await deleteSession(runtime.resolveSessionPath())
      return { ok: true as const, value: { ok: true as const } }
    }
    return internalError(`unknown Grok endpoint: ${endpoint}`)
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedGrokOptions | undefined
  const options = (): ResolvedGrokOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-grok: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const runtime = createGrokAuthRuntime({
    resolveSessionPath: () => resolveGrokSessionPath(ctx),
  })
  const adapter = new GrokAdapter({
    options,
    resolveApiKey: () => resolveGrokAccessToken(runtime),
    resolveAttachments: () => ctx.get('attachments'),
  })
  ctx.llm.registerConfigurableProviders([
    { provider: GROK_PROVIDER, displayName: 'Grok', settingsNs: NS, settingsPath: [] },
  ])
  const registration = ctx.llm.registerAdapter([GROK_PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([GROK_PROVIDER])
    registeredPolicy = policy
  }

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      GROK_RPC_CHANNEL,
      createGrokRpcHandler(runtime),
      { authority: 'loopback' },
    )
  })

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
