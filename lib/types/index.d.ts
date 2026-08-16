/**
 * Register the `grok` provider directory entry, the Responses chat adapter,
 * the `llm-grok` settings section, and the loopback `/grok` auth RPC. Billing
 * is not installed yet. The route is distinct from the built-in `xai`
 * console-key provider.
 * @module dsh-llm-grok
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import type { GrokConnectionOptions } from './adapter.ts';
import type { GrokOAuthRuntime } from './oauth.ts';
export { GrokAdapter, resolveGrokAccessToken } from './adapter.ts';
export type { GrokAdapterOptions, GrokConnectionOptions } from './adapter.ts';
export { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_PROVIDER, GROK_SETTINGS_NAMESPACE, GROK_RPC_CHANNEL, GROK_AUTH_START_ENDPOINT, GROK_AUTH_STATUS_ENDPOINT, GROK_AUTH_LOGOUT_ENDPOINT, decodeGrokSettings, decodeGrokAuthStatus, decodeGrokAuthStartReply, decodeGrokAuthLogoutReply, decodeGrokEmptyRequest, } from './client-contract.ts';
export { GROK_CHAT_BASE_URL, GROK_DEFAULT_CONTEXT_WINDOW, GROK_DEFAULT_MODEL_MAX_TOKENS, GROK_PLUGIN_IDENTITY_HEADER, createGrokPiAiProfile, } from './pi-ai-profile.ts';
export { GROK_SERVER_SEARCH_TOOLS, grokResponsesApi, injectGrokServerSearchTools } from './responses-tools.ts';
export type { GrokCatalogModel, GrokSettingsView, GrokAuthStatus, GrokAuthStartReply, GrokAuthLogoutReply, } from './client-contract.ts';
export { GROK_OAUTH_ISSUER, GROK_OAUTH_CLIENT_ID, GROK_OAUTH_SCOPE, createGrokAuthRuntime, ensureFreshSession, refreshSession, startPkceLogin, } from './oauth.ts';
export type { GrokOAuthRuntime, GrokOidcEndpoints } from './oauth.ts';
export { GROK_SESSION_FILENAME, resolveGrokSessionPath, sessionPathForHome, readSession, writeSession, deleteSession, statusFromSession, } from './session.ts';
export type { GrokSession } from './session.ts';
export declare const name = "llm-grok";
export declare const inject: string[];
/** One resolution's complete request facts. */
export type ResolvedGrokOptions = GrokConnectionOptions;
/**
 * The one explicit resolve step from raw config to validated connection facts.
 * Catalog membership and the chat base URL are source constants.
 * @param config - raw plugin config or resolved settings snapshot.
 */
export declare function resolveAdapterOptions(config: Config): ResolvedGrokOptions;
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-grok` settings-section shape. There is no `apiKeyEnv`: this
 * provider authenticates with an xAI subscription, not a console API key.
 */
export interface Config {
    /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs?: number;
    /** Provider-owned model-request retry policy; omission uses normal defaults. */
    retryPolicy?: RetryPolicyConfig;
}
export declare const Config: z<Config>;
/**
 * Loopback `/grok` handler. Status and start replies never include tokens.
 * @param runtime - Host OAuth runtime (production or a test fake).
 */
export declare function createGrokRpcHandler(runtime: GrokOAuthRuntime): ConnectionRpcHandler;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map