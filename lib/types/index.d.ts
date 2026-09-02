/**
 * Register the `grok` provider directory entry, the Responses chat adapter,
 * the `llm-grok` settings section, and the Host Connection `/grok` auth and usage RPC.
 * The route is distinct from the built-in `xai` console-key provider.
 * @module dsh-llm-grok
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import type { GrokConnectionOptions } from './adapter.ts';
import type { GrokCatalogModel } from './client-contract.ts';
import type { GrokOAuthRuntime } from './oauth.ts';
export { GrokAdapter, resolveGrokAccessToken } from './adapter.ts';
export type { GrokAdapterOptions, GrokConnectionOptions } from './adapter.ts';
export { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_PROVIDER, GROK_SETTINGS_NAMESPACE, GROK_RPC_CHANNEL, GROK_AUTH_START_ENDPOINT, GROK_AUTH_STATUS_ENDPOINT, GROK_AUTH_ATTEMPT_STATUS_ENDPOINT, GROK_AUTH_LOGOUT_ENDPOINT, GROK_AUTH_COMPLETE_ENDPOINT, GROK_AUTH_CANCEL_ENDPOINT, GROK_MODELS_ENDPOINT, GROK_SETTINGS_READ_ENDPOINT, GROK_SAVE_ENDPOINT, GROK_USAGE_ENDPOINT, decodeGrokSettings, decodeGrokSaveRequest, decodeGrokSaveResult, decodeGrokSettingsReadResult, decodeGrokAuthStatus, decodeGrokAuthAttemptStatus, decodeGrokAuthStartReply, decodeGrokAuthLogoutReply, decodeGrokAuthCompleteRequest, decodeGrokEmptyRequest, decodeGrokUsageView, decodeGrokUsageReply, decodeGrokModelsReply, } from './client-contract.ts';
export { GROK_CHAT_BASE_URL, GROK_DEFAULT_CONTEXT_WINDOW, GROK_DEFAULT_MODEL_MAX_TOKENS, GROK_PLUGIN_IDENTITY_HEADER, createGrokPiAiProfile, } from './pi-ai-profile.ts';
export { GROK_SERVER_SEARCH_TOOLS, grokResponsesApi, injectGrokServerSearchTools } from './responses-tools.ts';
export { isGrokServerSearchToolCallId, stripGrokServerSearchToolCalls, } from './server-search-calls.ts';
export { GROK_PACKED_REASONING_TYPE, expandPackedGrokReasoningInput, filterGrokThinkingStream, isDisplayableThinking, isGrokPackedReasoning, packGrokThinkingBlocks, } from './reasoning-display.ts';
export { GROK_REASONING_WIRES, GROK_DEFAULT_REASONING_WIRE, GROK_4_6_REASONING_EFFORTS, GROK_4_5_REASONING_EFFORTS, applyGrokReasoningWire, grokThinkingLevelMap, officialDefaultEffort, officialEffortsFor, resolveGrokReasoningWire, } from './reasoning.ts';
export type { GrokCatalogModel, GrokReasoningEffort, GrokSaveRequest, GrokSaveResult, GrokSettingsReadResult, GrokSettingsView, GrokAuthStatus, GrokAuthStartReply, GrokAuthLogoutReply, GrokUsageWindow, GrokUsageView, GrokUsageReply, GrokModelsReply, } from './client-contract.ts';
export { GROK_OAUTH_ISSUER, GROK_OAUTH_CLIENT_ID, GROK_OAUTH_SCOPE, createGrokAuthRuntime, beginPkceLogin, cancelAllPkceLogins, cancelPkceLogin, completePkceLogin, ensureFreshSession, refreshSession, startPkceLogin, } from './oauth.ts';
export type { GrokOAuthRuntime, GrokOidcEndpoints } from './oauth.ts';
export { GROK_SESSION_FILENAME, resolveGrokSessionPath, sessionPathForHome, readSession, writeSession, deleteSession, statusFromSession, } from './session.ts';
export type { GrokSession } from './session.ts';
export { GROK_BILLING_URL, DEFAULT_USAGE_REQUEST_TIMEOUT_MS, parseGrokBilling, readGrokUsage, } from './usage.ts';
export { GROK_MODELS_URL, parseGrokModels, readGrokModels, fallbackGrokCatalog } from './discovery.ts';
export type { GrokUsageRequest } from './usage.ts';
export { GROK_IMAGE_GEN_TOOL_NAME, grokImageGenTool } from './image-gen.ts';
export { installGrokModelSwitchAdapters } from './model-switch-adapter.ts';
export { GROK_IMAGINE_ASPECT_RATIOS, GROK_IMAGINE_BASE_URL, GROK_IMAGINE_MODEL, generateGrokImage, } from './image-gen-client.ts';
export declare const name = "llm-grok";
export declare const inject: string[];
/** One resolution's complete request facts. */
export type ResolvedGrokOptions = GrokConnectionOptions;
export declare function resolveAdapterOptions(config: Config): ResolvedGrokOptions;
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-grok` settings-section shape. There is no `apiKeyEnv`: this
 * provider authenticates with an xAI subscription, not a console API key.
 */
export interface Config {
    /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs?: number;
    /** Displayed conversation-picker catalog; omission uses the frozen default. */
    models?: GrokCatalogModel[];
    /** When true, register the `grok_image_gen` tool. Default off. */
    enableImageGen?: boolean;
    /** Provider-owned model-request retry policy; omission uses normal defaults. */
    retryPolicy?: RetryPolicyConfig;
    /** Set false when Model Switch owns stable tool names, preventing legacy duplicates. */
    registerLegacyTools?: boolean;
}
export declare const Config: z<Config>;
/** Optional Host overrides for the authenticated Host Connection handler (local billing in tests). */
export interface GrokRpcHandlerOptions {
    /** Override {@link GROK_BILLING_URL} for a local fake billing server. */
    billingURL?: string;
    /** Override the production models-v2 URL for tests. */
    modelsURL?: string;
}
/**
 * Host Connection `/grok` handler. Status, start, and usage replies never include tokens;
 * the Alpha.4 Host Connection service applies browser authentication and trusted-host policy.
 * @param runtime - Host OAuth runtime (production or a test fake).
 * @param options - optional billing URL override for tests.
 */
export declare function createGrokRpcHandler(runtime: GrokOAuthRuntime, options?: GrokRpcHandlerOptions): ConnectionRpcHandler;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map