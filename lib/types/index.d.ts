/**
 * Register the Grok provider, its loader-backed Config, and authenticated
 * account/catalog RPC carried by the shared `/api` connection.
 * @module dsh-llm-grok
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import type { GrokConnectionOptions } from './adapter.ts';
import type { GrokCatalogModel } from './client-contract.ts';
import type { GrokOAuthRuntime } from './oauth.ts';
export { GrokAdapter, refreshGrokAccessToken, resolveGrokAccessToken } from './adapter.ts';
export type { GrokAdapterOptions, GrokConnectionOptions } from './adapter.ts';
export { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_PROVIDER, GROK_SETTINGS_NAMESPACE, GROK_RPC_METHOD, GROK_AUTH_START_ENDPOINT, GROK_AUTH_STATUS_ENDPOINT, GROK_AUTH_ATTEMPT_STATUS_ENDPOINT, GROK_AUTH_LOGOUT_ENDPOINT, GROK_AUTH_COMPLETE_ENDPOINT, GROK_AUTH_CANCEL_ENDPOINT, GROK_MODELS_ENDPOINT, GROK_USAGE_ENDPOINT, decodeGrokAuthStatus, decodeGrokAuthAttemptStatus, decodeGrokAuthStartReply, decodeGrokAuthLogoutReply, decodeGrokAuthCompleteRequest, decodeGrokEmptyRequest, decodeGrokUsageView, decodeGrokUsageReply, decodeGrokModelsReply, } from './client-contract.ts';
export { GROK_CHAT_BASE_URL, GROK_DEFAULT_CONTEXT_WINDOW, GROK_DEFAULT_MODEL_MAX_TOKENS, GROK_PLUGIN_IDENTITY_HEADER, createGrokPiAiProfile, } from './pi-ai-profile.ts';
export { GROK_SERVER_SEARCH_TOOLS, grokResponsesApi, injectGrokServerSearchTools } from './responses-tools.ts';
export { GROK_SEARCH_LABEL, GROK_SEARCH_PROVIDER, GrokSearchProvider, grokSearchModels, isSearchableGrokModel, mapGrokSearchResponse, } from './search.ts';
export type { GrokSearchProviderOptions } from './search.ts';
export { isGrokServerSearchToolCallId, stripGrokServerSearchToolCalls, } from './server-search-calls.ts';
export { GROK_PACKED_REASONING_TYPE, expandPackedGrokReasoningInput, filterGrokThinkingStream, isDisplayableThinking, isGrokPackedReasoning, packGrokThinkingBlocks, } from './reasoning-display.ts';
export { GROK_REASONING_WIRES, GROK_DEFAULT_REASONING_WIRE, GROK_4_6_REASONING_EFFORTS, GROK_4_5_REASONING_EFFORTS, applyGrokReasoningWire, grokThinkingLevelMap, officialDefaultEffort, officialEffortsFor, resolveGrokReasoningWire, } from './reasoning.ts';
export type { GrokCatalogModel, GrokReasoningEffort, GrokSettingsForm, GrokAuthStatus, GrokAuthStartReply, GrokAuthLogoutReply, GrokUsageWindow, GrokUsageView, GrokUsageReply, GrokModelsReply, } from './client-contract.ts';
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
type CatalogModelSchemaInput = {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    contextWindow?: number | null;
    maxTokens?: number | null;
    reasoningEfforts?: Array<{
        id?: string | null;
        value?: string | null;
        label?: string | null;
        description?: string | null;
    }> | null;
    defaultReasoningEffort?: string | null;
    vision?: boolean | null;
    thinking?: boolean | null;
    tools?: boolean | null;
};
type ConfigField<T> = T | Volatile<T | undefined>;
interface ConfigValues {
    streamIdleTimeoutMs?: number;
    models?: ConfigField<GrokCatalogModel[]>;
    enableImageGen?: ConfigField<boolean>;
    retryPolicy?: RetryPolicyConfig;
    registerLegacyTools?: boolean;
}
export declare function resolveAdapterOptions(config: ConfigValues): ResolvedGrokOptions;
/** Parsed Loader Config; volatile fields hold stable references to validated snapshots. */
export type Config = {
    streamIdleTimeoutMs: number;
    models: Volatile<GrokCatalogModel[]>;
    enableImageGen: Volatile<boolean>;
    retryPolicy: RetryPolicyConfig;
    registerLegacyTools: boolean;
};
type ConfigSchemaInput = {
    streamIdleTimeoutMs?: number | null;
    models?: CatalogModelSchemaInput[] | null;
    enableImageGen?: boolean | null;
    retryPolicy?: RetryPolicyConfig | null;
    registerLegacyTools?: boolean | null;
};
export declare const Config: z<ConfigSchemaInput, Config>;
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
 * Every usage failure is answered as a result rather than thrown, preserving
 * its LlmError code: an unusable credential answers `INVALID_CREDENTIAL`
 * so the shared quota cache drops the previous account's entry.
 * @param runtime - Host OAuth runtime (production or a test fake).
 * @param options - optional billing URL override for tests.
 */
export declare function createGrokRpcHandler(runtime: GrokOAuthRuntime, options?: GrokRpcHandlerOptions): ConnectionRpcHandler;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map