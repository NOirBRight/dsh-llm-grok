/**
 * Register the Grok provider, its loader-backed Config, and authenticated
 * account/catalog RPC carried by the shared `/api` connection.
 * @module dsh-llm-grok
 */

import type { Context, Fiber, Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type { ConnectionFetchRoute, ConnectionRpcHandler, ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import { LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { allowDshRuntime } from './compatibility.ts'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
import { GrokAdapter, refreshGrokAccessToken, resolveGrokAccessToken } from './adapter.ts'
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
  GROK_RPC_METHOD,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthCompleteRequest,
  decodeGrokEmptyRequest,
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

function withAuthRetries(policy: ResolvedRetryPolicy): ResolvedRetryPolicy {
  if (policy.mode !== 'normal') return policy
  if (policy.retryableCodes.includes('AUTH')) return policy
  return { ...policy, retryableCodes: Object.freeze([...policy.retryableCodes, 'AUTH']) }
}

export { GrokAdapter, refreshGrokAccessToken, resolveGrokAccessToken } from './adapter.ts'
export type { GrokAdapterOptions, GrokConnectionOptions } from './adapter.ts'
export {
  GROK_CATALOG,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_SETTINGS_NAMESPACE,
  GROK_RPC_METHOD,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_AUTH_ATTEMPT_STATUS_ENDPOINT,
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_COMPLETE_ENDPOINT,
  GROK_AUTH_CANCEL_ENDPOINT,
  GROK_MODELS_ENDPOINT,
  GROK_USAGE_ENDPOINT,
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
  GROK_SEARCH_LABEL,
  GROK_SEARCH_PROVIDER,
  GrokSearchProvider,
  grokSearchModels,
  isSearchableGrokModel,
  mapGrokSearchResponse,
} from './search.ts'
export type { GrokSearchProviderOptions } from './search.ts'
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
  GrokSettingsForm,
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

const NS = GROK_SETTINGS_NAMESPACE

/** One resolution's complete request facts. */
export type ResolvedGrokOptions = GrokConnectionOptions

type CatalogModelSchemaInput = {
  id?: string | null
  name?: string | null
  description?: string | null
  contextWindow?: number | null
  maxTokens?: number | null
  reasoningEfforts?: Array<{ id?: string | null; value?: string | null; label?: string | null; description?: string | null }> | null
  defaultReasoningEffort?: string | null
  vision?: boolean | null
  thinking?: boolean | null
  tools?: boolean | null
}

const catalogModel: z<CatalogModelSchemaInput, GrokCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  reasoningEfforts: z.array(z.object({
    id: z.string().required(),
    value: z.string().required(),
    label: z.string(),
    description: z.string(),
  })),
  defaultReasoningEffort: z.string(),
  vision: z.boolean(),
  thinking: z.boolean(),
  tools: z.boolean(),
})

/** Shape accepted by Schemastery before optional nullable fields are normalized. */
type CatalogModelInput = CatalogModelSchemaInput | GrokCatalogModel | VolatileSnapshot<GrokCatalogModel>

function normalizeCatalogModel(model: CatalogModelInput): GrokCatalogModel {
  if (typeof model.id !== 'string') throw new Error('llm-grok: catalog model ids must be strings')
  const reasoningEfforts = model.reasoningEfforts?.map((effort) => {
    if (typeof effort.id !== 'string' || typeof effort.value !== 'string') {
      throw new Error(`llm-grok: catalog model "${model.id}" reasoning efforts need string ids and values`)
    }
    return {
      id: effort.id,
      value: effort.value,
      ...typeof effort.label === 'string' ? { label: effort.label } : {},
      ...typeof effort.description === 'string' ? { description: effort.description } : {},
    }
  })
  return {
    id: model.id,
    ...typeof model.name === 'string' ? { name: model.name } : {},
    ...typeof model.description === 'string' ? { description: model.description } : {},
    ...typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {},
    ...typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {},
    ...typeof model.thinking === 'boolean' ? { thinking: model.thinking } : {},
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    ...typeof model.defaultReasoningEffort === 'string' ? { defaultReasoningEffort: model.defaultReasoningEffort } : {},
    ...typeof model.vision === 'boolean' ? { vision: model.vision } : {},
    ...typeof model.tools === 'boolean' ? { tools: model.tools } : {},
  }
}

/** Normalize catalog values and reject duplicate ids before the provider uses an update. */
function resolveModels(models: readonly CatalogModelInput[] | undefined): GrokCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? GROK_CATALOG).map((input) => {
    const model = normalizeCatalogModel(input)
    if (model.id.length === 0) throw new Error('llm-grok: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-grok: catalog model "${model.id}" has an empty name`)
    }
    if (seen.has(model.id)) throw new Error(`llm-grok: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return model
  })
}

type ConfigField<T> = T | Volatile<T | undefined>
interface ConfigValues {
  streamIdleTimeoutMs?: number
  models?: ConfigField<GrokCatalogModel[]>
  enableImageGen?: ConfigField<boolean>
  retryPolicy?: RetryPolicyConfig
  registerLegacyTools?: boolean
}

function isVolatile<T>(value: T | Volatile<T | undefined> | undefined): value is Volatile<T | undefined> {
  return typeof value === 'object'
    && value !== null
    && 'get' in value
    && typeof value.get === 'function'
}

function configValue<T>(
  value: T | Volatile<T | undefined> | undefined,
): T | VolatileSnapshot<T | undefined> | undefined {
  return isVolatile(value) ? value.get() : value
}

export function resolveAdapterOptions(config: ConfigValues): ResolvedGrokOptions {
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
    models: resolveModels(configValue(config.models)),
    streamIdleTimeoutMs,
    retryPolicy: withAuthRetries(resolveRetryPolicy(
      config.retryPolicy ?? { mode: 'normal', maxRetries: DEFAULT_MAX_RETRIES },
      'llm-grok: retryPolicy',
    )),
  }
}

const catalogModels = z.array(catalogModel).default(GROK_CATALOG.map(model => ({ ...model }))).volatile()

/** Parsed Loader Config; volatile fields hold stable references to validated snapshots. */
export type Config = {
  streamIdleTimeoutMs: number
  models: Volatile<GrokCatalogModel[]>
  enableImageGen: Volatile<boolean>
  retryPolicy: RetryPolicyConfig
  registerLegacyTools: boolean
}

type ConfigSchemaInput = {
  streamIdleTimeoutMs?: number | null
  models?: CatalogModelSchemaInput[] | null
  enableImageGen?: boolean | null
  retryPolicy?: RetryPolicyConfig | null
  registerLegacyTools?: boolean | null
}

export const Config: z<ConfigSchemaInput, Config> = z.object({
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(
    GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  ),
  models: catalogModels,
  enableImageGen: z.boolean().default(false).volatile(),
  retryPolicy: RetryPolicySchema,
  registerLegacyTools: z.boolean().default(true),
})

function failure(code: string, message: string) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      details: {},
    },
  }
}

function internalError(message: string) {
  return failure('internal', message)
}

/** Optional Host overrides for the authenticated Host Connection handler (local billing in tests). */
export interface GrokRpcHandlerOptions {
  /** Override {@link GROK_BILLING_URL} for a local fake billing server. */
  billingURL?: string
  /** Override the production models-v2 URL for tests. */
  modelsURL?: string
}

/**
 * Map one usage failure onto the wire so it never escapes the handler as a
 * gateway error. An LlmError keeps the code its throw site chose; a non-LlmError
 * failure stays internal. The usage path raises only `INVALID_CREDENTIAL`
 * (`src/usage.ts` on a billing 401/403), which is the one code the shared
 * provider-UI quota cache treats as an unusable credential, so classifying the
 * failure belongs to the read that saw the rejecting status.
 * @param error - thrown value from credential resolution or the billing read.
 * @param secrets - token material that must never reach the browser.
 */
function usageFailure(error: unknown, secrets: readonly string[]) {
  let message = error instanceof Error && error.message.length > 0
    ? error.message
    : 'Grok usage read failed'
  for (const secret of secrets) {
    if (secret.length === 0) continue
    message = message.split(secret).join('[redacted]')
  }
  if (!(error instanceof LlmError)) return internalError(message)
  return failure(error.code, message)
}

/**
 * Host Connection `/grok` handler. Status, start, and usage replies never include tokens;
 * the Alpha.4 Host Connection service applies browser authentication and trusted-host policy.
 * Every usage failure is answered as a result rather than thrown, preserving
 * its LlmError code: an unusable credential answers `INVALID_CREDENTIAL`
 * so the shared quota cache drops the previous account's entry.
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
      let secrets: readonly string[] = []
      try {
        const session = await ensureFreshSession(runtime)
        if (session === undefined) return { ok: true as const, value: { status: 'logged-out' as const } }
        secrets = [session.accessToken, session.refreshToken]
        const value = await readGrokUsage({
          accessToken: session.accessToken,
          ...options?.billingURL === undefined ? {} : { billingURL: options.billingURL },
          fetch: runtime.fetch,
          now: runtime.now,
          signal,
        })
        return { ok: true as const, value }
      } catch (error: unknown) {
        return usageFailure(error, secrets)
      }
    }
    return internalError(`unknown Grok endpoint: ${endpoint}`)
  }
}

function grokRpcResponse(rpcId: string, result: ConnectionRpcHandlerResult): Response {
  const response = { type: 'server-response' as const, rpcId, result }
  if (!result.ok || result.attachments === undefined || result.attachments.length === 0) {
    return Response.json(response)
  }

  const form = new FormData()
  const attachments = result.attachments.map((attachment, index) => {
    const part = `bytes-${index}`
    form.set(part, new Blob([new Uint8Array(attachment.bytes)]))
    return { path: [...attachment.path], codec: 'bytes', part }
  })
  form.set('metadata', JSON.stringify({ ...response, attachments }))
  return new Response(form)
}

function createGrokRpcFetch(
  handler: ConnectionRpcHandler,
  operator: Parameters<ConnectionRpcHandler>[3],
): (request: Request) => Promise<Response> {
  return async request => {
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return new Response('unsupported media type', { status: 415 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response('invalid JSON', { status: 400 })
    }
    const parsed = clientRequestSchema.safeParse(body)
    if (!parsed.success) return new Response('invalid RPC request', { status: 400 })
    const message = parsed.data
    if (message.method !== GROK_RPC_METHOD) return new Response('invalid RPC method', { status: 400 })

    const value = message.payload
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return new Response('invalid RPC payload', { status: 400 })
    }
    const wrapped = value as Record<string, unknown>
    if (!Object.hasOwn(wrapped, 'endpoint')
      || typeof wrapped['endpoint'] !== 'string'
      || Object.keys(wrapped).some(key => key !== 'endpoint' && key !== 'payload')) {
      return new Response('invalid RPC payload', { status: 400 })
    }

    try {
      const result = await handler(wrapped['endpoint'], wrapped['payload'], request.signal, operator)
      return grokRpcResponse(message.rpcId, result)
    } catch {
      return new Response('internal server error', { status: 500 })
    }
  }
}


export function apply(ctx: Context, config: Config): void {
  if (!allowDshRuntime(ctx.logger, 'dsh-llm-grok', ['@deepseek-ai/dsh-llm'])) return

  let lastRaw: Config | undefined
  let lastGood: ResolvedGrokOptions | undefined
  const options = (): ResolvedGrokOptions => {
    const raw = config
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-grok: keeping the last good configuration after an invalid Loader Config')
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
    refreshApiKey: () => refreshGrokAccessToken(runtime),
    resolveAttachments: () => ctx.get('attachments'),
  })
  ctx.llm.registerConfigurableProviders([
    { provider: GROK_PROVIDER, displayName: 'Grok', settingsNs: NS, settingsPath: [] },
  ])
  const registration = ctx.llm.registerAdapter([GROK_PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  let registeredModels = options().models
  const ensureRegistrationFacts = (): void => {
    lastRaw = undefined
    const resolved = options()
    if (deepEqualJson(resolved.retryPolicy, registeredPolicy)
      && deepEqualJson(resolved.models, registeredModels)) return
    registration.replace([GROK_PROVIDER])
    registeredPolicy = resolved.retryPolicy
    registeredModels = resolved.models
  }

  const connectionFiber = ctx.inject(['connection'], connectionCtx => {
    const handler = createGrokRpcHandler(runtime)
    const route: ConnectionFetchRoute = {
      path: '/api/plugin-rpc/grok',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createGrokRpcFetch(handler, connectionCtx.connection.operator),
    }
    connectionCtx.effect(
      () => connectionCtx.connection.fetch.register(route),
      'llm-grok: register authenticated Grok RPC route',
    )
  })
  ctx.effect(() => () => connectionFiber.dispose(), 'llm-grok: dispose Host Connection injection')
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'llm-grok: use custom Loader Config page',
    )
  })


  let stopped = false
  let imageGenFiber: Fiber | undefined
  let imageGenTail: Promise<void> = Promise.resolve()

  const reconcileImageGen = async (): Promise<void> => {
    if (stopped) return
    const enabled = config.registerLegacyTools !== false && configValue(config.enableImageGen) === true
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
  ctx.on('loader/volatile-update', paths => {
    if (paths.some(path => path[0] === 'models' || path[0] === 'enableImageGen')) scheduleCapabilities()
  })

  scheduleCapabilities()
  ctx.effect(() => async () => {
    stopped = true
    await imageGenTail
    const imageGen = imageGenFiber
    imageGenFiber = undefined
    await imageGen?.dispose()
  })
}
