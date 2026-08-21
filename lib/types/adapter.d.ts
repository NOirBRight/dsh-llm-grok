/**
 * Grok subscription chat adapter. The public route stays `grok`, while the
 * wire implementation is delegated to pi-ai's OpenAI Responses support.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { GrokCatalogModel } from './client-contract.ts';
import type { GrokOAuthRuntime } from './oauth.ts';
import type { GrokConnectionOptions } from './pi-ai-profile.ts';
export type { GrokConnectionOptions } from './pi-ai-profile.ts';
/** Constructor options for GrokAdapter: the operation-local resolution hooks the plugin owns. */
export interface GrokAdapterOptions {
    /** Current validated connection facts; called once per operation. */
    options: () => GrokConnectionOptions;
    /**
     * Resolve the bearer access token for one request. Throws LlmError
     * MISSING_CREDENTIAL when no session exists, or AUTH when refresh failed.
     */
    resolveApiKey: () => Promise<string>;
    /** Resolve the optional durable attachment service at request time. */
    resolveAttachments?: () => AttachmentStore | undefined;
}
/**
 * Return the current access token, refreshing when the session is near expiry.
 * A missing session is MISSING_CREDENTIAL. A session that existed but whose
 * refresh failed (and was cleared) is AUTH.
 * @param runtime - Host OAuth runtime.
 */
export declare function resolveGrokAccessToken(runtime: GrokOAuthRuntime): Promise<string>;
/**
 * Replace pi-ai's generated effort list with official models-v2 order, labels,
 * and the documented default `reasoning.effort`.
 */
export declare function applyOfficialReasoningMetadata(info: LlmResolvedModelInfo, catalog: GrokCatalogModel | undefined): LlmResolvedModelInfo;
/** The Grok chat adapter backed by pi-ai OpenAI Responses. */
export declare class GrokAdapter extends LlmAdapter {
    private readonly config;
    private readonly auth;
    private snapshot;
    constructor(config: GrokAdapterOptions);
    /** Rebuild the delegated adapter only when the plugin publishes a new options snapshot. */
    private current;
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=adapter.d.ts.map