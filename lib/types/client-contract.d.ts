/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */
/** Settings namespace owned by the Grok plugin. */
export declare const GROK_SETTINGS_NAMESPACE = "llm-grok";
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
export declare const GROK_PROVIDER = "grok";
/** Default maximum idle interval while a stream read is outstanding. */
export declare const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** One model in the plugin's frozen catalog. */
export interface GrokCatalogModel {
    /** Wire model id accepted by the chat proxy. */
    id: string;
    /** Whether the model supports native thinking. */
    thinking?: boolean;
    /** Whether the model accepts image input. */
    vision?: boolean;
}
/**
 * Source-frozen advisory catalog. V1 does not fetch an account directory;
 * later tickets may append ids to this constant only.
 */
export declare const GROK_CATALOG: readonly GrokCatalogModel[];
/** Settings fields presented by the package's Web configuration card. No apiKeyEnv. */
export interface GrokSettingsView {
    /** Stream idle timeout in milliseconds. */
    streamIdleTimeoutMs: number;
}
/**
 * Narrow the schema-resolved settings section before it enters React state.
 * @param value - untrusted settings response value.
 * @returns the validated settings view, or undefined when the response is invalid.
 */
export declare function decodeGrokSettings(value: unknown): GrokSettingsView | undefined;
//# sourceMappingURL=client-contract.d.ts.map