/**
 * Inject xAI server-side search tools into an outbound Responses body.
 * Pi-ai only emits `{ type: "function" }` tools; the proxy runs web_search
 * and x_search itself. Search results come back as encrypted `type: reasoning`
 * items (`tco_*`) with empty summaries — packed off the Think UI, replayed
 * on the next request. This is not a `ctx.web` provider.
 */
import type { Context as PiContext, ProviderStreams } from '@earendil-works/pi-ai';
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
/**
 * Fold pi `system` messages into `context.systemPrompt` before pi-ai 0.85.x
 * sees them.
 *
 * Newer `dsh-llm-pi-ai` seams deliver the harness system prompt (and developer
 * tool declarations) as `role: "system"` messages whose `content` may be a
 * plain string. pi-ai 0.85.x both crashes estimating such messages
 * (`estimateMessageTokens` iterates non-user content as a block array and
 * reads `block.name.length` off a string character) and silently drops any
 * role it does not convert on the wire. Lifting them into the supported
 * `systemPrompt` field fixes the estimation crash *and* restores the prompt
 * and tool declarations on the wire. Tool updates merge into `context.tools`
 * (deduplicated by name; removed names dropped), the only tool channel pi-ai
 * 0.85.x understands. Fixed upstream in pi-ai 1.3.0 (`role === "system"`
 * branch); this is the plugin-owned backport for the `^0.85.1` line.
 */
export declare function liftSystemMessages(context: PiContext): PiContext;
export declare function grokResponsesApi(models?: readonly GrokCatalogModel[]): ProviderStreams;
//# sourceMappingURL=responses-tools.d.ts.map