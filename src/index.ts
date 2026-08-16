/**
 * Register the `grok` provider directory entry, the `llm-grok` settings
 * section, and the loopback `/grok` auth and usage RPC. Chat is not
 * installed yet. The route is distinct from the built-in `xai` console-key
 * provider.
 * @module dsh-llm-grok
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_RPC_CHANNEL,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokEmptyRequest,
} from './client-contract.ts'
import { createGrokAuthRuntime, ensureFreshSession, startPkceLogin } from './oauth.ts'
import type { GrokOAuthRuntime } from './oauth.ts'
import { deleteSession, resolveGrokSessionPath, statusFromSession } from './session.ts'
import { readGrokUsage } from './usage.ts'

export {
  GROK_CATALOG,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_SETTINGS_NAMESPACE,
  GROK_RPC_CHANNEL,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_USAGE_ENDPOINT,
  decodeGrokSettings,
  decodeGrokAuthStatus,
  decodeGrokAuthStartReply,
  decodeGrokAuthLogoutReply,
  decodeGrokEmptyRequest,
  decodeGrokUsageView,
  decodeGrokUsageReply,
} from './client-contract.ts'
export type {
  GrokCatalogModel,
  GrokSettingsView,
  GrokAuthStatus,
  GrokAuthStartReply,
  GrokAuthLogoutReply,
  GrokUsageWindow,
  GrokUsageView,
  GrokUsageReply,
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
export {
  GROK_BILLING_URL,
  DEFAULT_USAGE_REQUEST_TIMEOUT_MS,
  parseGrokBilling,
  readGrokUsage,
} from './usage.ts'
export type { GrokUsageRequest } from './usage.ts'

export const name = 'llm-grok'
export const inject = ['llm']

const NS = settingsNamespace(GROK_SETTINGS_NAMESPACE)

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

/** Optional Host overrides for the loopback handler (local billing in tests). */
export interface GrokRpcHandlerOptions {
  /** Override {@link GROK_BILLING_URL} for a local fake billing server. */
  billingURL?: string
}

function usageFailure(error: unknown, secrets: readonly string[]) {
  let message = error instanceof Error && error.message.length > 0
    ? error.message
    : 'Grok usage read failed'
  for (const secret of secrets) {
    if (secret.length === 0) continue
    message = message.split(secret).join('[redacted]')
  }
  return internalError(message)
}

/**
 * Loopback `/grok` handler. Status, start, and usage replies never include tokens.
 * @param runtime - Host OAuth runtime (production or a test fake).
 * @param options - optional billing URL override for tests.
 */
export function createGrokRpcHandler(
  runtime: GrokOAuthRuntime,
  options?: GrokRpcHandlerOptions,
): ConnectionRpcHandler {
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
    if (endpoint === GROK_USAGE_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok usage request')
      const session = await ensureFreshSession(runtime)
      if (session === undefined) return { ok: true as const, value: { status: 'logged-out' as const } }
      try {
        const value = await readGrokUsage({
          accessToken: session.accessToken,
          ...options?.billingURL === undefined ? {} : { billingURL: options.billingURL },
          fetch: runtime.fetch,
          now: runtime.now,
          signal,
        })
        return { ok: true as const, value }
      } catch (error: unknown) {
        return usageFailure(error, [session.accessToken, session.refreshToken])
      }
    }
    return internalError(`unknown Grok endpoint: ${endpoint}`)
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.llm.registerConfigurableProviders([
    { provider: GROK_PROVIDER, displayName: 'Grok', settingsNs: NS, settingsPath: [] },
  ])

  const runtime = createGrokAuthRuntime({
    resolveSessionPath: () => resolveGrokSessionPath(ctx),
  })
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      GROK_RPC_CHANNEL,
      createGrokRpcHandler(runtime),
      { authority: 'loopback' },
    )
  })

  installSettingsSection(ctx, NS, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })
}
