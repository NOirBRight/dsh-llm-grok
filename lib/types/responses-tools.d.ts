/**
 * Inject xAI server-side search tools into an outbound Responses body.
 * Pi-ai only emits `{ type: "function" }` tools; the proxy runs web_search
 * and x_search itself. Search results come back as encrypted `type: reasoning`
 * items (`tco_*`) with empty summaries — packed off the Think UI, replayed
 * on the next request. This is not a `ctx.web` provider.
 */
import type { ProviderStreams } from '@earendil-works/pi-ai';
import type { GrokCatalogModel } from './client-contract.ts';
/** Server-side search tools the Grok CLI chat proxy accepts on every request. */
export declare const GROK_SERVER_SEARCH_TOOLS: readonly [{
    readonly type: "web_search";
}, {
    readonly type: "x_search";
}];
/**
 * Append `{ type: "web_search" }` and `{ type: "x_search" }` when missing.
 * Leaves non-object payloads unchanged.
 * @param payload - the Responses `create` body pi-ai is about to send.
 */
export declare function injectGrokServerSearchTools(payload: unknown): unknown;
export declare function grokResponsesApi(models?: readonly GrokCatalogModel[]): ProviderStreams;
//# sourceMappingURL=responses-tools.d.ts.map