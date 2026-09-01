/**
 * Grok subscription chat adapter. The public route stays `grok`, while the
 * wire implementation is delegated to pi-ai's OpenAI Responses support.
 */

import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { GROK_PROVIDER } from './client-contract.ts'
import type { GrokCatalogModel } from './client-contract.ts'
import { officialDefaultEffort, officialEffortsFor, isGrokReasoningWire } from './reasoning.ts'
import { ensureFreshSession } from './oauth.ts'
import type { GrokOAuthRuntime } from './oauth.ts'
import { createGrokPiAiProfile } from './pi-ai-profile.ts'
import type { GrokConnectionOptions } from './pi-ai-profile.ts'
import { createGrokPiAiAuth } from './pi-ai-auth.ts'
import { readSession } from './session.ts'

export type { GrokConnectionOptions } from './pi-ai-profile.ts'

/** Constructor options for GrokAdapter: the operation-local resolution hooks the plugin owns. */
export interface GrokAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => GrokConnectionOptions
  /**
   * Resolve the bearer access token for one request. Throws LlmError
   * MISSING_CREDENTIAL when no session exists, or AUTH when refresh failed.
   */
  resolveApiKey: () => Promise<string>
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
}

/**
 * Return the current access token, refreshing when the session is near expiry.
 * A missing session is MISSING_CREDENTIAL. A session that existed but whose
 * refresh failed (and was cleared) is AUTH.
 * @param runtime - Host OAuth runtime.
 */
export async function resolveGrokAccessToken(runtime: GrokOAuthRuntime): Promise<string> {
  const path = runtime.resolveSessionPath()
  const existing = await readSession(path)
  const session = await ensureFreshSession(runtime)
  if (session === undefined) {
    if (existing !== undefined) {
      throw new LlmError(
        'llm-grok: session refresh failed; sign in again with an xAI subscription',
        'AUTH',
      )
    }
    throw new LlmError(
      'llm-grok: not signed in; sign in with an xAI subscription from Plugin configuration',
      'MISSING_CREDENTIAL',
    )
  }
  return session.accessToken
}

/**
 * Replace pi-ai's generated effort list with official models-v2 order, labels,
 * and the documented default `reasoning.effort`.
 */
export function applyOfficialReasoningMetadata(
  info: LlmResolvedModelInfo,
  catalog: GrokCatalogModel | undefined,
): LlmResolvedModelInfo {
  if (info.reasoning === undefined || catalog === undefined || catalog.thinking !== true) {
    return info
  }
  const supported = new Set(info.reasoning.efforts.map(effort => effort.id))
  const efforts = officialEffortsFor(catalog).flatMap((effort) => {
    if (!isGrokReasoningWire(effort.value) || !supported.has(ReasoningEffortId(effort.value))) return []
    return [{
      id: ReasoningEffortId(effort.value),
      name: effort.label ?? effort.value,
      ...effort.description === undefined ? {} : { description: effort.description },
    }]
  })
  if (efforts.length === 0) return info
  const preferred = ReasoningEffortId(officialDefaultEffort(catalog))
  const defaultEffort = efforts.some(effort => effort.id === preferred) ? preferred : efforts[0]?.id
  return {
    ...info,
    reasoning: {
      efforts,
      ...defaultEffort === undefined ? {} : { defaultEffort },
    },
  }
}

function classifyGrokTransientError(chunk: StreamChunk): StreamChunk {
  if (chunk.type !== 'finish' || chunk.reason.kind !== 'error' || chunk.reason.failure.code !== 'PI_AI_ERROR') {
    return chunk
  }
  const message = chunk.reason.failure.message
  const code = /currently at capacity|high demand/iu.test(message)
    ? 'RATE_LIMIT'
    : /service temporarily unavailable|availability is currently degraded/iu.test(message)
      ? 'SERVER'
      : undefined
  if (code === undefined) return chunk
  return {
    ...chunk,
    reason: {
      ...chunk.reason,
      failure: { ...chunk.reason.failure, code },
    },
  }
}


const SANDBOX_MODE_RANK: Record<string, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

/**
 * Remove sandbox escalation choices that cannot be strictly wider than the
 * current DSH policy. Core still validates every retained request; this only
 * prevents Grok from selecting an impossible optional enum value.
 * Scans both options.system and DSH context-injection messages.
 */
export function narrowGrokEscalationSchemas(options: GenerateOptions): GenerateOptions {
  const mode = sandboxModeOf(options)
  const currentRank = mode === undefined ? undefined : SANDBOX_MODE_RANK[mode]
  if (currentRank === undefined || options.tools === undefined) return options
  let changed = false
  const tools = options.tools.map((tool) => {
    const parameters = tool.parameters
    const properties = isRecord(parameters.properties) ? parameters.properties : undefined
    const permission = properties === undefined || !isRecord(properties.sandbox_permissions)
      ? undefined
      : properties.sandbox_permissions
    if (permission === undefined || !Array.isArray(permission.enum)) return tool
    const wider = permission.enum.filter((candidate): candidate is string => {
      return typeof candidate === 'string' && (SANDBOX_MODE_RANK[candidate] ?? -1) > currentRank
    })
    if (wider.length === permission.enum.length) return tool
    changed = true
    const nextProperties = { ...properties }
    if (wider.length === 0) {
      delete nextProperties.sandbox_permissions
      delete nextProperties.justification
    } else {
      nextProperties.sandbox_permissions = { ...permission, enum: wider }
    }
    const required = Array.isArray(parameters.required)
      ? parameters.required.filter(name => name !== 'sandbox_permissions' && name !== 'justification')
      : undefined
    return {
      ...tool,
      parameters: {
        ...parameters,
        properties: nextProperties,
        ...(required === undefined ? {} : { required }),
      },
    }
  })
  return changed ? { ...options, tools } : options
}

function sandboxModeOf(options: GenerateOptions): string | undefined {
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    const message = options.messages[index] as unknown
    if (!isRecord(message)) continue
    const found = sandboxModeIn((message as { content?: unknown }).content)
    if (found !== undefined) return found
  }
  return sandboxModeIn(options.system)
}

function sandboxModeIn(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return /Current DSH file policy:\s*(read-only|workspace-write|danger-full-access)\./u.exec(value)?.[1]
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = sandboxModeIn(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  return sandboxModeIn((value as Record<string, unknown>).text) ?? sandboxModeIn((value as Record<string, unknown>).content)
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The Grok chat adapter backed by pi-ai OpenAI Responses. */
export class GrokAdapter extends LlmAdapter {
  private readonly auth = createGrokPiAiAuth()
  private snapshot: { options: GrokConnectionOptions, adapter: PiAiAdapter } | undefined

  constructor(private readonly config: GrokAdapterOptions) {
    super()
  }

  /** Rebuild the delegated adapter only when the plugin publishes a new options snapshot. */
  private current(): PiAiAdapter {
    const options = this.config.options()
    if (this.snapshot?.options === options) return this.snapshot.adapter
    const profile = createGrokPiAiProfile(options)
    const profiles = new Map<string, ResolvedPiAiProviderProfile>([[GROK_PROVIDER, profile]])
    const adapterOptions = {
      profiles: () => profiles,
      resolveApiKey: () => this.config.resolveApiKey(),
      auth: this.auth,
      ...this.config.resolveAttachments === undefined
        ? {}
        : { resolveAttachments: this.config.resolveAttachments },
    }
    const adapter = new PiAiAdapter(adapterOptions)
    this.snapshot = { options, adapter }
    return adapter
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return this.current().providerInfo(provider)
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.current().providerRetryPolicy(provider)
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.snapshot = undefined
    return this.current().listModels(provider)
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const info = await this.current().resolveModel(provider, model, signal)
    const catalog = this.config.options().models.find(entry => entry.id === model)
    return applyOfficialReasoningMetadata(info, catalog)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    for await (const chunk of this.current().stream(narrowGrokEscalationSchemas(options))) {
      yield classifyGrokTransientError(chunk)
    }
  }

  /** Prepare one request with Grok's stream transforms applied. */
  override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
    const inner = await this.current().prepareCall(provider, model, signal)
    return {
      model: inner.model,
      stream: async function* (options: GenerateOptions) {
        for await (const chunk of inner.stream(narrowGrokEscalationSchemas(options))) {
          yield classifyGrokTransientError(chunk)
        }
      },
    }
  }

  /**
   * Declare no provider-specific image pricing so the Host uses neutral estimation.
   * @param _provider - provider route.
   * @param _model - model id.
   * @returns `undefined` because Grok has no image token pricing contract.
   */
  override imageRequestPricing(_provider: string, _model: string): undefined {
    return undefined
  }
}
