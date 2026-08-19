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
  const code = /currently at capacity|high demand|priority processing/iu.test(message)
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

/** The Grok chat adapter backed by pi-ai OpenAI Responses. */
export class GrokAdapter extends LlmAdapter {
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
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: () => this.config.resolveApiKey(),
      ...this.config.resolveAttachments === undefined
        ? {}
        : { resolveAttachments: this.config.resolveAttachments },
    })
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
    for await (const chunk of this.current().stream(options)) {
      yield classifyGrokTransientError(chunk)
    }
  }
}
