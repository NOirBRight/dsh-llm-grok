/**
 * Account model catalog from cli-chat-proxy GET /v1/models-v2.
 */
import type { GrokCatalogModel } from './client-contract.ts';
/** Production models URL. */
export declare const GROK_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models-v2";
/**
 * Parse a models-v2 (or /v1/models) list body.
 * @param value - JSON body.
 */
export declare function parseGrokModels(value: unknown): GrokCatalogModel[] | undefined;
/** One Host catalog read. */
export interface GrokModelsRequest {
    accessToken: string;
    modelsURL?: string;
    fetch?: typeof fetch;
    signal?: AbortSignal;
}
/**
 * Read the signed-in account catalog. Failures return undefined so callers
 * can keep the last good / frozen list.
 */
export declare function readGrokModels(request: GrokModelsRequest): Promise<GrokCatalogModel[] | undefined>;
/** Frozen fallback used when discovery has not succeeded. */
export declare function fallbackGrokCatalog(): GrokCatalogModel[];
//# sourceMappingURL=discovery.d.ts.map