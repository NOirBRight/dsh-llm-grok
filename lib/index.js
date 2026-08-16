import z from "@deepseek-ai/schemastery";
import { RetryPolicySchema } from "@deepseek-ai/dsh-llm";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
//#region lib/types/client-contract.js
/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */
/** Settings namespace owned by the Grok plugin. */
const GROK_SETTINGS_NAMESPACE = "llm-grok";
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
const GROK_PROVIDER = "grok";
/** Default maximum idle interval while a stream read is outstanding. */
const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Source-frozen advisory catalog. V1 does not fetch an account directory;
* later tickets may append ids to this constant only.
*/
const GROK_CATALOG = Object.freeze([Object.freeze({
	id: "grok-4.6",
	thinking: true,
	vision: true
})]);
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Narrow the schema-resolved settings section before it enters React state.
* @param value - untrusted settings response value.
* @returns the validated settings view, or undefined when the response is invalid.
*/
function decodeGrokSettings(value) {
	if (!isRecord(value)) return void 0;
	const streamIdleTimeoutMs = value["streamIdleTimeoutMs"];
	if (typeof streamIdleTimeoutMs !== "number" || !Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) return;
	return { streamIdleTimeoutMs };
}
//#endregion
//#region lib/types/index.js
/**
* Register the `grok` provider directory entry and the `llm-grok` settings
* section. Chat and OAuth are not installed yet; this face only contributes
* Plugin configuration identity so the Web card can render. The route is
* distinct from the built-in `xai` console-key provider.
* @module dsh-llm-grok
*/
const name = "llm-grok";
const inject = ["llm"];
const NS = settingsNamespace(GROK_SETTINGS_NAMESPACE);
const Config = z.object({
	streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS),
	retryPolicy: RetryPolicySchema
});
function apply(ctx, config) {
	ctx.llm.registerConfigurableProviders([{
		provider: GROK_PROVIDER,
		displayName: "Grok",
		settingsNs: NS,
		settingsPath: []
	}]);
	installSettingsSection(ctx, NS, Config, config, {
		setSource: () => {},
		onChange: () => {}
	});
}
//#endregion
export { Config, GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_PROVIDER, GROK_SETTINGS_NAMESPACE, apply, decodeGrokSettings, inject, name };
