/**
 * Grok subscription chat adapter. The public route stays `grok`, while the
 * wire implementation is delegated to pi-ai's OpenAI Responses support.
 */

import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
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

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.current().listModels(provider)
  }

  override resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return this.current().resolveModel(provider, model, signal)
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.current().stream(options)
  }
}
