/**
 * Grok provider-owned independent web search.
 *
 * One search is one non-streaming Responses request against the same CLI
 * chat proxy the chat adapter streams from ({baseURL}/responses), with the
 * same server-side search tools ({ type: 'web_search' }, { type: 'x_search' }),
 * tool_choice required so the call searches independently of chat phrasing,
 * and the same subscription access token resolved through the public
 * credential interface (resolveGrokAccessToken). No scraping, no invented
 * sources: only citeable http(s) URLs actually returned by the proxy become
 * WebSearchSource entries, and a response without any such evidence fails
 * instead of returning an empty guess.
 *
 * Failures are explicit: an unlisted model is rejected before any request,
 * a missing session surfaces as WEB_PROVIDER_CREDENTIAL_MISSING, and a
 * native response without citeable evidence is WEB_PROVIDER_ERROR.
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
/** Stable provider id shared with the chat route and the Model Switch adapter. */
export declare const GROK_SEARCH_PROVIDER = "grok";
/** Display label for the agreed Model Switch search-adapter metadata. */
export declare const GROK_SEARCH_LABEL = "Grok";
/** Models whose chat proxy requests accept the server-side search tools. */
export declare function grokSearchModels(): readonly {
    readonly id: string;
    readonly name: string;
}[];
/** Whether model is a chat model the proxy runs server-side search tools for. */
export declare function isSearchableGrokModel(model: string): boolean;
/** One independent search: bearer token plus test overrides. Production uses global fetch. */
export interface GrokSearchProviderOptions {
    /** Bearer access token for one request (public credential interface, never logged). */
    readonly resolveAccessToken: () => Promise<string>;
    /** Chat model id; must satisfy isSearchableGrokModel. */
    readonly model: string;
    /** Override the proxy base (default GROK_CHAT_BASE_URL). */
    readonly baseURL?: string;
    /** Override global fetch in tests; the request endpoint is captured from it. */
    readonly fetchImpl?: typeof fetch;
}
/**
 * Map one native Responses body onto the official result vocabulary.
 * Citations come from output_text url_citation annotations and from results
 * arrays on native search-call output items only; anything else is ignored.
 * @param value - decoded JSON body from POST {base}/responses.
 */
export declare function mapGrokSearchResponse(value: unknown): WebSearchResult;
/** Provider-owned search over the CLI chat proxy Responses API. */
export declare class GrokSearchProvider implements WebSearchProvider {
    private readonly options;
    readonly id = "grok";
    constructor(options: GrokSearchProviderOptions);
    /** Cheap local check; never touches the network. */
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
//# sourceMappingURL=search.d.ts.map