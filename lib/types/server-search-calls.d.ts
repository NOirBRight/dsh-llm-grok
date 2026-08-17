/**
 * Grok's always-on `web_search` / `x_search` run on the proxy. Results
 * come back as encrypted `tco_*` reasoning. Grok also sometimes echoes the
 * same search as a client `custom_tool_call` whose call_id is `xs_call-*`
 * / `ws_call-*` and whose name is copied from the DSH prompt
 * (`x_keyword_search`, `x_semantic_search`, …).
 *
 * Those names are not DSH top-level tools (Code mode only exposes
 * `run_code`). If they reach the agent loop they paint
 * `unknown tool "x_keyword_search"`. Drop them from the DSH-visible
 * stream; search already ran server-side.
 */
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
/**
 * True when this tool-call id is a Grok server search echo, not a DSH
 * function. The id is `call_id|item_id`; only the call_id prefix matters.
 */
export declare function isGrokServerSearchToolCallId(id: string | undefined): boolean;
/** Strip server-search echoes and relax `toolUse` when nothing else remains. */
export declare function stripGrokServerSearchToolCalls(message: AssistantMessage): AssistantMessage;
/** Hold server-search toolcall_* events off the DSH stream. */
export declare class GrokServerSearchCallFilter {
    private readonly hidden;
    /** Map one upstream event to the events DSH should see. */
    take(event: AssistantMessageEvent): AssistantMessageEvent[];
}
//# sourceMappingURL=server-search-calls.d.ts.map