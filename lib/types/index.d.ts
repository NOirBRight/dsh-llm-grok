/**
 * Register the `grok` provider directory entry and the `llm-grok` settings
 * section. Chat and OAuth are not installed yet; this face only contributes
 * Plugin configuration identity so the Web card can render. The route is
 * distinct from the built-in `xai` console-key provider.
 * @module dsh-llm-grok
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
export { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_PROVIDER, GROK_SETTINGS_NAMESPACE, decodeGrokSettings, } from './client-contract.ts';
export type { GrokCatalogModel, GrokSettingsView } from './client-contract.ts';
export declare const name = "llm-grok";
export declare const inject: string[];
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
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map