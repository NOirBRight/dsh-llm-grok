/**
 * Register the `grok` provider directory entry, the Responses chat adapter,
 * the `llm-grok` settings section, and the loopback `/grok` auth and usage RPC.
 * The route is distinct from the built-in `xai` console-key provider.
 * @module dsh-llm-grok
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { ensureProviderOrderSettings } from 'dsh-llm-providers-ui'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
import { GrokAdapter, resolveGrokAccessToken } from './adapter.ts'
import { grokImageGenTool } from './image-gen.ts'
import { installGrokModelSwitchAdapters } from './model-switch-adapter.ts'
import type { GrokConnectionOptions } from './adapter.ts'
import {
  GROK_AUTH_COMPLETE_ENDPOINT,
  GROK_AUTH_CANCEL_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_AUTH_ATTEMPT_STATUS_ENDPOINT,
  GROK_CATALOG,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_MODELS_ENDPOINT,
  GROK_PROVIDER,
  GROK_RPC_CHANNEL,
  GROK_SAVE_ENDPOINT,
  GROK_SETTINGS_READ_ENDPOINT,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthCompleteRequest,
  decodeGrokEmptyRequest,
  decodeGrokSaveRequest,
  decodeGrokSettings,
} from './client-contract.ts'
import type { GrokCatalogModel } from './client-contract.ts'
import { beginPkceLogin, cancelAllPkceLogins, cancelPkceLogin, completePkceLogin, createGrokAuthRuntime, ensureFreshSession, statusPkceLogin } from './oauth.ts'
import type { GrokOAuthRuntime } from './oauth.ts'
import { GROK_CHAT_BASE_URL } from './pi-ai-profile.ts'
import { deleteSession, resolveGrokSessionPath, statusFromSession } from './session.ts'
import { fallbackGrokCatalog, readGrokModels } from './discovery.ts'
import { readGrokUsage } from './usage.ts'

/** Preserve Grok's historical normal retry count across host-line default changes. */
const DEFAULT_MAX_RETRIES = 2

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
  GROK_AUTH_ATTEMPT_STATUS_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_COMPLETE_ENDPOINT,
  GROK_AUTH_CANCEL_ENDPOINT,
  GROK_MODELS_ENDPOINT,
  GROK_SETTINGS_READ_ENDPOINT,
  GROK_SAVE_ENDPOINT,
  GROK_USAGE_ENDPOINT,
  decodeGrokSettings,
  decodeGrokSaveRequest,
  decodeGrokSaveResult,
  decodeGrokSettingsReadResult,
  decodeGrokAuthStatus,
  decodeGrokAuthAttemptStatus,
  decodeGrokAuthStartReply,
  decodeGrokAuthLogoutReply,
  decodeGrokAuthCompleteRequest,
  decodeGrokEmptyRequest,
  decodeGrokUsageView,
  decodeGrokUsageReply,
  decodeGrokModelsReply,
} from './client-contract.ts'
export {
  GROK_CHAT_BASE_URL,
  GROK_DEFAULT_CONTEXT_WINDOW,
  GROK_DEFAULT_MODEL_MAX_TOKENS,
  GROK_PLUGIN_IDENTITY_HEADER,
  createGrokPiAiProfile,
} from './pi-ai-profile.ts'
export { GROK_SERVER_SEARCH_TOOLS, grokResponsesApi, injectGrokServerSearchTools } from './responses-tools.ts'
export {
  isGrokServerSearchToolCallId,
  stripGrokServerSearchToolCalls,
} from './server-search-calls.ts'
export {
  GROK_PACKED_REASONING_TYPE,
  expandPackedGrokReasoningInput,
  filterGrokThinkingStream,
  isDisplayableThinking,
  isGrokPackedReasoning,
  packGrokThinkingBlocks,
} from './reasoning-display.ts'
export {
  GROK_REASONING_WIRES,
  GROK_DEFAULT_REASONING_WIRE,
  GROK_4_6_REASONING_EFFORTS,
  GROK_4_5_REASONING_EFFORTS,
  applyGrokReasoningWire,
  grokThinkingLevelMap,
  officialDefaultEffort,
  officialEffortsFor,
  resolveGrokReasoningWire,
} from './reasoning.ts'
export type {
  GrokCatalogModel,
  GrokReasoningEffort,
  GrokSaveRequest,
  GrokSaveResult,
  GrokSettingsReadResult,
  GrokSettingsView,
  GrokAuthStatus,
  GrokAuthStartReply,
  GrokAuthLogoutReply,
  GrokUsageWindow,
  GrokUsageView,
  GrokUsageReply,
  GrokModelsReply,
} from './client-contract.ts'
export {
  GROK_OAUTH_ISSUER,
  GROK_OAUTH_CLIENT_ID,
  GROK_OAUTH_SCOPE,
  createGrokAuthRuntime,
  beginPkceLogin,
  cancelAllPkceLogins,
  cancelPkceLogin,
  completePkceLogin,
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
export { GROK_MODELS_URL, parseGrokModels, readGrokModels, fallbackGrokCatalog } from './discovery.ts'
export type { GrokUsageRequest } from './usage.ts'
export { GROK_IMAGE_GEN_TOOL_NAME, grokImageGenTool } from './image-gen.ts'
export { installGrokModelSwitchAdapters } from './model-switch-adapter.ts'
export {
  GROK_IMAGINE_ASPECT_RATIOS,
  GROK_IMAGINE_BASE_URL,
  GROK_IMAGINE_MODEL,
  generateGrokImage,
} from './image-gen-client.ts'

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
function resolveModels(models: readonly GrokCatalogModel[] | undefined): GrokCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? GROK_CATALOG).map((model) => {
    if (model.id.length === 0) throw new Error('llm-grok: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-grok: catalog model "${model.id}" has an empty name`)
    }
    if (seen.has(model.id)) throw new Error(`llm-grok: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...model.thinking === undefined ? {} : { thinking: model.thinking },
      ...model.vision === undefined ? {} : { vision: model.vision },
      ...model.tools === undefined ? {} : { tools: model.tools },
      ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
      ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
    }
  })
}

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
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(
      config.retryPolicy ?? { mode: 'normal', maxRetries: DEFAULT_MAX_RETRIES },
      'llm-grok: retryPolicy',
    ),
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
  /** Displayed conversation-picker catalog; omission uses the frozen default. */
  models?: GrokCatalogModel[]
  /** When true, register the `grok_image_gen` tool. Default off. */
  enableImageGen?: boolean
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
  /** Set false when Model Switch owns stable tool names, preventing legacy duplicates. */
  registerLegacyTools?: boolean
  /** Permit explicitly trusted-host management RPCs; default false. */
  remoteManagement?: boolean
}

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  vision: z.boolean(),
  thinking: z.boolean(),
  tools: z.boolean(),
})

export const Config: z<Config> = z.object({
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(
    GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  ),
  models: z.array(catalogModel),
  enableImageGen: z.boolean().default(false),
  retryPolicy: RetryPolicySchema,
  registerLegacyTools: z.boolean().default(true),
  remoteManagement: z.boolean().default(false),
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
  /** Override the production models-v2 URL for tests. */
  modelsURL?: string
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
      const started = await beginPkceLogin(runtime)
      return {
        ok: true as const,
        value: 'attemptId' in started ? { ok: true as const, ...started } : started,
      }
    }
    if (endpoint === GROK_AUTH_ATTEMPT_STATUS_ENDPOINT) {
      const attemptId = (payload as { attemptId?: unknown })?.attemptId
      if (typeof attemptId !== 'string' || attemptId.length === 0) return internalError('invalid Grok auth attempt status request')
      return { ok: true as const, value: { attemptId, state: statusPkceLogin(runtime, attemptId) } }
    }
    if (endpoint === GROK_AUTH_STATUS_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok auth status request')
      const session = await ensureFreshSession(runtime)
      return { ok: true as const, value: statusFromSession(session) }
    }
    if (endpoint === GROK_AUTH_LOGOUT_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok auth logout request')
      cancelAllPkceLogins(runtime)
      await deleteSession(runtime.resolveSessionPath())
      return { ok: true as const, value: { ok: true as const } }
    }
    if (endpoint === GROK_AUTH_CANCEL_ENDPOINT) {
      const value = payload as { attemptId?: unknown }
      if (typeof value?.attemptId !== 'string' || value.attemptId.length === 0) return internalError('invalid Grok auth cancel request')
      if (!cancelPkceLogin(runtime, value.attemptId)) return internalError('stale Grok sign-in attempt')
      return { ok: true as const, value: { ok: true as const } }
    }
    if (endpoint === GROK_AUTH_COMPLETE_ENDPOINT) {
      const request = decodeGrokAuthCompleteRequest(payload)
      if (request === undefined) return internalError('invalid Grok auth complete request')
      if (request.attemptId !== undefined) return { ok: true as const, value: await completePkceLogin(runtime, request.attemptId, request.code) }
      return { ok: true as const, value: await completePkceLogin(runtime, request.code) }
    }
    if (endpoint === GROK_MODELS_ENDPOINT) {
      if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok models request')
      const session = await ensureFreshSession(runtime)
      if (session === undefined) return { ok: true as const, value: { models: fallbackGrokCatalog() } }
      const models = await readGrokModels({
        accessToken: session.accessToken,
        ...options?.modelsURL === undefined ? {} : { modelsURL: options.modelsURL },
        fetch: runtime.fetch,
        signal,
      }) ?? fallbackGrokCatalog()
      return { ok: true as const, value: { models } }
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

/** Return the schema-decoded, secret-free settings snapshot and descriptor revision. */
async function readDisplayedSettings(ctx: Context, payload: unknown) {
  if (decodeGrokEmptyRequest(payload) === undefined) return internalError('invalid Grok settings read request')
  const descriptor = ctx.get('settings')?.describe().find(entry => entry.ns === NS)
  if (descriptor === undefined) return internalError('Grok settings are unavailable')
  const settings = decodeGrokSettings(descriptor.value)
  if (settings === undefined) return internalError('Grok settings are invalid')
  return { ok: true as const, value: { settings, revision: descriptor.revision } }
}
async function saveDisplayedCatalog(ctx: Context, payload: unknown) {
  const request = decodeGrokSaveRequest(payload)
  if (request === undefined) return internalError('invalid Grok settings request')
  const settings = ctx.get('settings')
  if (settings === undefined) return internalError('Grok settings are unavailable')
  try {
    const before = settings.describe().find(descriptor => descriptor.ns === NS)
    if (before === undefined) return internalError('Grok settings are unavailable')
    const current = decodeGrokSettings(before.value)
    if (current === undefined) return internalError('Grok settings are invalid')
    const ops: SettingsPathOp[] = []
    if (!deepEqualJson(current.models, request.models)) {
      ops.push({ op: 'set', path: ['models'], value: request.models })
    }
    if (request.enableImageGen !== undefined && current.enableImageGen !== request.enableImageGen) {
      ops.push({ op: 'set', path: ['enableImageGen'], value: request.enableImageGen })
    }
    if (ops.length > 0) await settings.mutate(NS, ops, request.expectedRevision)
    const accepted = settings.describe().find(descriptor => descriptor.ns === NS)
    const acceptedSettings = decodeGrokSettings(accepted?.value)
    if (accepted === undefined || acceptedSettings === undefined) {
      return internalError('Grok settings could not be reloaded')
    }
    return { ok: true as const, value: { settings: acceptedSettings, revision: accepted.revision } }
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.length > 0
      ? error.message
      : 'Grok settings save failed'
    return internalError(message)
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
  ctx.effect(() => () => { cancelAllPkceLogins(runtime) }, 'llm-grok: cancel OAuth attempts')
  installGrokModelSwitchAdapters(ctx, runtime)
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
    lastRaw = undefined
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([GROK_PROVIDER])
    registeredPolicy = policy
  }

  ctx.inject(['connection'], (connectionCtx) => {
    const inner = createGrokRpcHandler(runtime)
    connectionCtx.connection.rpc.handle(
      GROK_RPC_CHANNEL,
      async (endpoint, payload, signal) => {
        if (endpoint === GROK_SETTINGS_READ_ENDPOINT) return readDisplayedSettings(ctx, payload)
        if (endpoint === GROK_SAVE_ENDPOINT) return saveDisplayedCatalog(ctx, payload)
        return inner(endpoint, payload, signal)
      },
      { authority: current().remoteManagement === true ? 'trusted-host' : 'loopback' },
    )
  })

  ensureProviderOrderSettings(ctx)
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source as () => Config
    },
    onChange: scheduleCapabilities,
  })

  let stopped = false
  let imageGenFiber: Fiber | undefined
  let imageGenTail: Promise<void> = Promise.resolve()

  const reconcileImageGen = async (): Promise<void> => {
    if (stopped) return
    const enabled = current().registerLegacyTools !== false && current().enableImageGen === true
    if (enabled === (imageGenFiber !== undefined)) return
    const previous = imageGenFiber
    imageGenFiber = undefined
    if (previous !== undefined) await previous.dispose()
    if (stopped || !enabled) return
    const fiber = ctx.inject(
      ['tools', 'fs', 'attachments'],
      toolCtx => toolCtx.tools.register(grokImageGenTool(toolCtx, {
        resolveAccessToken: () => resolveGrokAccessToken(runtime),
      })),
    )
    imageGenFiber = fiber
    void Promise.resolve(fiber).catch((error: unknown) => {
      if (imageGenFiber === fiber) imageGenFiber = undefined
      ctx.logger.error('llm-grok: optional grok_image_gen tool failed to activate')
      ctx.logger.error(error)
    })
  }

  function scheduleCapabilities(): void {
    ensureRegistrationFacts()
    imageGenTail = imageGenTail.then(reconcileImageGen, reconcileImageGen).catch((error: unknown) => {
      ctx.logger.error('llm-grok: could not apply the updated grok_image_gen configuration')
      ctx.logger.error(error)
    })
  }

  scheduleCapabilities()
  ctx.effect(() => async () => {
    stopped = true
    await imageGenTail
    const imageGen = imageGenFiber
    imageGenFiber = undefined
    await imageGen?.dispose()
  })
}
