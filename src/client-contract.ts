/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */

/** Settings namespace owned by the Grok plugin. */
export const GROK_SETTINGS_NAMESPACE = 'llm-grok'
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
export const GROK_PROVIDER = 'grok'
/** Default maximum idle interval while a stream read is outstanding. */
export const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** One model in the plugin's frozen catalog. */
export interface GrokCatalogModel {
  /** Wire model id accepted by the chat proxy. */
  id: string
  /** Whether the model supports native thinking. */
  thinking?: boolean
  /** Whether the model accepts image input. */
  vision?: boolean
}

/**
 * Source-frozen advisory catalog. V1 does not fetch an account directory;
 * later tickets may append ids to this constant only.
 */
export const GROK_CATALOG: readonly GrokCatalogModel[] = Object.freeze([
  Object.freeze({ id: 'grok-4.6', thinking: true, vision: true }),
])

/** Settings fields presented by the package's Web configuration card. No apiKeyEnv. */
export interface GrokSettingsView {
  /** Stream idle timeout in milliseconds. */
  streamIdleTimeoutMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow the schema-resolved settings section before it enters React state.
 * @param value - untrusted settings response value.
 * @returns the validated settings view, or undefined when the response is invalid.
 */
export function decodeGrokSettings(value: unknown): GrokSettingsView | undefined {
  if (!isRecord(value)) return undefined
  const streamIdleTimeoutMs = value['streamIdleTimeoutMs']
  if (typeof streamIdleTimeoutMs !== 'number' || !Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) {
    return undefined
  }
  return { streamIdleTimeoutMs }
}
