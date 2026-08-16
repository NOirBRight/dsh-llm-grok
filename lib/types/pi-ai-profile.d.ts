/**
 * Translate the frozen Grok catalog into the pi-ai profile used for OpenAI
 * Responses against the Grok CLI chat proxy.
 */
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm';
/** Chat proxy base used by the Grok CLI (`POST {base}/responses`). */
export declare const GROK_CHAT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** Context capacity used when the frozen catalog entry has none. */
export declare const GROK_DEFAULT_CONTEXT_WINDOW = 262144;
/** Safe output capability used when the frozen catalog entry has none. */
export declare const GROK_DEFAULT_MODEL_MAX_TOKENS = 32768;
/** Plugin identity sent beside the harness User-Agent. Not a Grok CLI header. */
export declare const GROK_PLUGIN_IDENTITY_HEADER: string;
/** Validated connection facts for one chat operation. */
export interface GrokConnectionOptions {
    /** Responses API base, including `/v1`. */
    baseURL: string;
    /** Maximum provider idle time while one stream read is outstanding. */
    streamIdleTimeoutMs: number;
    /** Provider-owned model-request retry policy, already resolved. */
    retryPolicy: ResolvedRetryPolicy;
}
/** Resolve the complete pi-ai profile for one Grok options snapshot. */
export declare function createGrokPiAiProfile(connection: GrokConnectionOptions): ResolvedPiAiProviderProfile;
//# sourceMappingURL=pi-ai-profile.d.ts.map