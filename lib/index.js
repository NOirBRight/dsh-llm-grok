import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { LlmAdapter, LlmError, ReasoningEffortId, RetryPolicySchema, createUserMessage, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { deepEqualJson } from "@deepseek-ai/dsh-util-values";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { createAssistantMessageEventStream, createProvider } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region lib/types/compatibility.js
/**
* Classify one runtime without treating the verified table as an allowlist.
* @param version - Resolved DSH runtime version.
* @param verified - Releases with direct compatibility evidence.
* @param blocklist - Versions excluded after reproduced failures.
* @returns The fail-open mount decision.
*/
function classifyDshRuntime(version, verified, blocklist = {}) {
	const reason = blocklist[version];
	if (typeof reason === "string" && reason.trim() !== "") return {
		kind: "blocked",
		reason
	};
	return verified.has(version) ? { kind: "verified" } : { kind: "unverified" };
}
/**
* Apply the fail-open decision and emit at most one visible warning.
* @param logger - Host logger receiving compatibility warnings.
* @param pluginName - Plugin identifier used in diagnostics.
* @param version - Resolved DSH runtime version.
* @param verified - Releases with direct compatibility evidence.
* @param blocklist - Versions excluded after reproduced failures.
* @returns Whether the host mount should continue.
*/
function shouldMountDshRuntime(logger, pluginName, version, verified, blocklist = {}) {
	const decision = classifyDshRuntime(version, verified, blocklist);
	if (decision.kind === "blocked") {
		logger.warn(`[${pluginName}] blocked on DSH ${version}: ${decision.reason}; see package.json#dsh.compatibility.blocklist`);
		return false;
	}
	if (decision.kind === "unverified") logger.warn(`[${pluginName}] best-effort on unverified runtime ${version}`);
	return true;
}
function readManifest() {
	try {
		return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	} catch {
		return {};
	}
}
function packageVersion(packageName) {
	try {
		const require = createRequire(import.meta.url);
		let directory = dirname(require.resolve(packageName));
		for (;;) {
			try {
				const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
				if (typeof manifest.version === "string" && manifest.version !== "") return manifest.version;
			} catch {}
			const parent = dirname(directory);
			if (parent === directory) return void 0;
			directory = parent;
		}
	} catch {
		return;
	}
}
/**
* Warn once for an unknown runtime while keeping the normal host mount path.
* @param logger - Host logger receiving compatibility warnings.
* @param pluginName - Plugin identifier used in diagnostics.
* @param candidates - DSH peer packages used to resolve the host version.
* @returns Whether the host mount should continue.
*/
function allowDshRuntime(logger, pluginName, candidates) {
	const version = process.env.DSH_VERSION?.trim() || candidates.map(packageVersion).find((value) => value !== void 0) || "unknown";
	const compatibility = readManifest().dsh?.compatibility;
	return shouldMountDshRuntime(logger, pluginName, version, new Set(Object.entries(compatibility?.dshReleases ?? {}).filter(([, status]) => status === "compatible" || status === "verified").map(([release]) => release)), compatibility?.blocklist);
}
//#endregion
//#region lib/types/client-contract.js
/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */
/** Settings namespace owned by the Grok plugin. */
const GROK_SETTINGS_NAMESPACE = "llm-grok";
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
const GROK_PROVIDER = "grok";
/** Default maximum idle interval while a stream read is outstanding. */
const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** Private Connection RPC channel used by this package's Host and Web faces. */
const GROK_RPC_CHANNEL = "/grok";
/** Begin a Host-owned PKCE sign-in against auth.x.ai. */
const GROK_AUTH_START_ENDPOINT = "auth/start";
/** Secret-free login snapshot. */
const GROK_AUTH_STATUS_ENDPOINT = "auth/status";
/** Read one secret-free in-flight authorization attempt status. */
const GROK_AUTH_ATTEMPT_STATUS_ENDPOINT = "auth/attempt-status";
/** Delete the Host session file. */
const GROK_AUTH_LOGOUT_ENDPOINT = "auth/logout";
/** Deliver a Grok Build paste-code into the in-flight PKCE exchange. */
const GROK_AUTH_COMPLETE_ENDPOINT = "auth/complete";
/** Cancel one pending Host-owned authorization attempt. */
const GROK_AUTH_CANCEL_ENDPOINT = "auth/cancel";
/** Secret-free subscription-usage snapshot inside {@link GROK_RPC_CHANNEL}. */
const GROK_USAGE_ENDPOINT = "usage/read";
/**
* Offline fallback when the account catalog cannot be read. Live ids come
* from GET /v1/models-v2 after sign-in.
*/
const GROK_4_6_EFFORTS = Object.freeze([
	Object.freeze({
		id: "xhigh",
		value: "xhigh",
		label: "Extra High Effort",
		description: "Highest effort and reasoning level"
	}),
	Object.freeze({
		id: "high",
		value: "high",
		label: "High Effort",
		description: "Higher implementation quality with extensive reasoning"
	}),
	Object.freeze({
		id: "medium",
		value: "medium",
		label: "Medium Effort",
		description: "Balanced effort with standard implementation and testing"
	}),
	Object.freeze({
		id: "low",
		value: "low",
		label: "Low Effort",
		description: "Quick, fast implementations"
	})
]);
const GROK_CATALOG = Object.freeze([Object.freeze({
	id: "grok-4.6",
	name: "Grok 4.6",
	thinking: true,
	vision: true,
	contextWindow: 5e5,
	defaultReasoningEffort: "high",
	reasoningEfforts: GROK_4_6_EFFORTS
}), Object.freeze({
	id: "grok-4.5",
	name: "Grok 4.5",
	thinking: true,
	vision: true,
	contextWindow: 5e5,
	defaultReasoningEffort: "high",
	reasoningEfforts: Object.freeze(GROK_4_6_EFFORTS.filter((effort) => effort.value !== "xhigh"))
})]);
/** Account model list inside {@link GROK_RPC_CHANNEL}. */
const GROK_MODELS_ENDPOINT = "models/list";
/** Read the redacted Grok settings snapshot through the management RPC. */
const GROK_SETTINGS_READ_ENDPOINT = "settings/read";
/** Atomic settings-save endpoint. */
const GROK_SAVE_ENDPOINT = "settings/save";
function isRecord$10(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
const TOKEN_FIELD = /^(?:accessToken|refreshToken|access_token|refresh_token|id_token|idToken|token)$/iu;
function hasTokenFields(value) {
	return Object.keys(value).some((key) => TOKEN_FIELD.test(key));
}
function optionalNonEmptyString(value) {
	return value === void 0 || typeof value === "string" && value.length > 0;
}
/**
* Narrow the schema-resolved settings section before it enters React state.
* @param value - untrusted settings response value.
* @returns the validated settings view, or undefined when the response is invalid.
*/
function decodeGrokSettings(value) {
	if (!isRecord$10(value)) return void 0;
	const streamIdleTimeoutMs = value["streamIdleTimeoutMs"];
	if (typeof streamIdleTimeoutMs !== "number" || !Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) return;
	const modelsValue = value["models"];
	const enableImageGen = value["enableImageGen"] === true;
	if (modelsValue === void 0) return {
		streamIdleTimeoutMs,
		models: GROK_CATALOG.map((model) => ({ ...model })),
		enableImageGen
	};
	if (!Array.isArray(modelsValue)) return void 0;
	const models = [];
	for (const entry of modelsValue) {
		const model = decodeGrokCatalogModel(entry);
		if (model === void 0) return void 0;
		models.push(model);
	}
	return {
		streamIdleTimeoutMs,
		models,
		enableImageGen
	};
}
/**
* Narrow an empty auth RPC payload. Token-shaped fields are rejected so a
* confused caller cannot push secrets across the authenticated Host Connection.
* @param value - untrusted RPC request payload.
* @returns an empty object, or undefined when the payload is invalid.
*/
/**
* Narrow a paste-code completion request. The value is an authorization code,
* not an access token; token-shaped field names are still rejected.
* @param value - untrusted RPC request payload.
*/
function decodeGrokAuthCompleteRequest(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const code = value["code"];
	const attemptId = value["attemptId"];
	if (typeof code !== "string" || code.trim().length === 0) return void 0;
	if (attemptId !== void 0 && (typeof attemptId !== "string" || attemptId.trim().length === 0)) return void 0;
	return {
		code: code.trim(),
		...attemptId === void 0 ? {} : { attemptId: attemptId.trim() }
	};
}
function decodeGrokEmptyRequest(value) {
	if (value === void 0 || value === null) return {};
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	return {};
}
/**
* Narrow the Host start-login reply before the card updates.
* @param value - untrusted RPC result value.
* @returns the validated reply, or undefined when it is malformed or carries secrets.
*/
function decodeGrokAuthStartReply(value) {
	if (!isRecord$10(value) || hasTokenFields(value) || typeof value["ok"] !== "boolean") return void 0;
	if (value["ok"] === true) {
		const attemptId = value["attemptId"];
		const authorizationUrl = value["authorizationUrl"];
		if (attemptId !== void 0 && (typeof attemptId !== "string" || attemptId.length === 0)) return void 0;
		if (authorizationUrl !== void 0 && (typeof authorizationUrl !== "string" || !authorizationUrl.startsWith("https://"))) return void 0;
		const popupBlocked = value["popupBlocked"];
		if (popupBlocked !== void 0 && typeof popupBlocked !== "boolean") return void 0;
		return {
			ok: true,
			...attemptId === void 0 ? {} : { attemptId },
			...authorizationUrl === void 0 ? {} : { authorizationUrl },
			...popupBlocked === void 0 ? {} : { popupBlocked }
		};
	}
	if (value["retryable"] !== true || typeof value["message"] !== "string" || value["message"].length === 0) return;
	return {
		ok: false,
		retryable: true,
		message: value["message"]
	};
}
/**
* Narrow the secret-free login snapshot. Token-shaped fields fail closed.
* @param value - untrusted RPC result value.
* @returns the validated status, or undefined when it is malformed or carries secrets.
*/
function decodeGrokAuthAttemptStatus(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const attemptId = value["attemptId"];
	const state = value["state"];
	if (typeof attemptId !== "string" || attemptId.length === 0) return void 0;
	if (state !== "pending" && state !== "succeeded" && state !== "failed" && state !== "cancelled" && state !== "expired") return void 0;
	return {
		attemptId,
		state
	};
}
function decodeGrokAuthStatus(value) {
	if (!isRecord$10(value) || hasTokenFields(value) || typeof value["loggedIn"] !== "boolean") return void 0;
	const email = value["email"];
	const expiresAt = value["expiresAt"];
	if (!optionalNonEmptyString(email) || !optionalNonEmptyString(expiresAt)) return void 0;
	return {
		loggedIn: value["loggedIn"],
		...email === void 0 ? {} : { email },
		...expiresAt === void 0 ? {} : { expiresAt }
	};
}
/**
* Narrow the logout reply.
* @param value - untrusted RPC result value.
* @returns the validated reply, or undefined when it is malformed or carries secrets.
*/
function decodeGrokAuthLogoutReply(value) {
	if (!isRecord$10(value) || hasTokenFields(value) || value["ok"] !== true) return void 0;
	return { ok: true };
}
function decodeGrokUsageWindow(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const id = value["id"];
	const used = value["used"];
	const limit = value["limit"];
	const period = value["period"];
	const unit = value["unit"];
	const resetsAt = value["resetsAt"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return void 0;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) return void 0;
	if (!optionalNonEmptyString(period)) return void 0;
	if (unit !== void 0 && unit !== "percent") return void 0;
	if (!optionalNonEmptyString(resetsAt)) return void 0;
	return {
		id,
		used,
		limit,
		...period === void 0 ? {} : { period },
		...unit === void 0 ? {} : { unit },
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/**
* Narrow one usage snapshot.
* @param value - untrusted JSON value.
* @returns the validated snapshot, or undefined when it is malformed or carries secrets.
*/
function decodeGrokUsageView(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	if (typeof value["fetchedAt"] !== "string" || value["fetchedAt"].length === 0) return void 0;
	if (!Array.isArray(value["windows"]) || value["windows"].length === 0) return void 0;
	const windows = [];
	for (const entry of value["windows"]) {
		const decoded = decodeGrokUsageWindow(entry);
		if (decoded === void 0) return void 0;
		windows.push(decoded);
	}
	return {
		fetchedAt: value["fetchedAt"],
		windows
	};
}
/**
* Narrow the usage reply returned by the Host usage endpoint.
* @param value - untrusted RPC result value.
* @returns the validated reply, or undefined when it is malformed or carries secrets.
*/
function decodeGrokReasoningEffort(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const id = value["id"];
	const wire = value["value"];
	const label = value["label"];
	const description = value["description"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (typeof wire !== "string" || wire.length === 0) return void 0;
	if (label !== void 0 && (typeof label !== "string" || label.length === 0)) return void 0;
	if (description !== void 0 && (typeof description !== "string" || description.length === 0)) return;
	return {
		id,
		value: wire,
		...label === void 0 ? {} : { label },
		...description === void 0 ? {} : { description }
	};
}
function decodeGrokCatalogModel(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const id = value["id"];
	const name = value["name"];
	const thinking = value["thinking"];
	const vision = value["vision"];
	const contextWindow = value["contextWindow"];
	const defaultReasoningEffort = value["defaultReasoningEffort"];
	const reasoningEffortsValue = value["reasoningEfforts"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (name !== void 0 && (typeof name !== "string" || name.length === 0)) return void 0;
	if (thinking !== void 0 && typeof thinking !== "boolean") return void 0;
	if (vision !== void 0 && typeof vision !== "boolean") return void 0;
	if (contextWindow !== void 0 && (typeof contextWindow !== "number" || !Number.isInteger(contextWindow) || contextWindow <= 0)) return void 0;
	if (defaultReasoningEffort !== void 0 && (typeof defaultReasoningEffort !== "string" || defaultReasoningEffort.length === 0)) return;
	let reasoningEfforts;
	if (reasoningEffortsValue !== void 0) {
		if (!Array.isArray(reasoningEffortsValue)) return void 0;
		reasoningEfforts = [];
		for (const entry of reasoningEffortsValue) {
			const effort = decodeGrokReasoningEffort(entry);
			if (effort === void 0) return void 0;
			reasoningEfforts.push(effort);
		}
	}
	return {
		id,
		...name === void 0 ? {} : { name },
		...thinking === void 0 ? {} : { thinking },
		...vision === void 0 ? {} : { vision },
		...contextWindow === void 0 ? {} : { contextWindow },
		...defaultReasoningEffort === void 0 ? {} : { defaultReasoningEffort },
		...reasoningEfforts === void 0 ? {} : { reasoningEfforts }
	};
}
function decodeGrokModelsReply(value) {
	if (!isRecord$10(value) || hasTokenFields(value) || !Array.isArray(value["models"])) return void 0;
	const models = [];
	for (const entry of value["models"]) {
		const model = decodeGrokCatalogModel(entry);
		if (model === void 0) return void 0;
		models.push(model);
	}
	return { models };
}
/**
* Narrow an atomic catalog-save request. Token-shaped fields fail closed.
* @param value - untrusted RPC request payload.
*/
function decodeGrokSaveRequest(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const expectedRevision = value["expectedRevision"];
	if (!Array.isArray(value["models"]) || typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)) return;
	if (value["enableImageGen"] !== void 0 && typeof value["enableImageGen"] !== "boolean") return void 0;
	const models = [];
	for (const entry of value["models"]) {
		const model = decodeGrokCatalogModel(entry);
		if (model === void 0) return void 0;
		models.push(model);
	}
	return {
		models,
		expectedRevision,
		...typeof value["enableImageGen"] === "boolean" ? { enableImageGen: value["enableImageGen"] } : {}
	};
}
/**
* Narrow the Host save reply before the card updates.
* @param value - untrusted RPC result value.
*/
/** Decode a redacted settings snapshot and its revision. */
function decodeGrokSettingsReadResult(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const revision = value["revision"];
	if (typeof revision !== "number" || !Number.isSafeInteger(revision)) return void 0;
	const settings = decodeGrokSettings(value["settings"]);
	return settings === void 0 ? void 0 : {
		settings,
		revision
	};
}
function decodeGrokSaveResult(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	const revision = value["revision"];
	if (typeof revision !== "number" || !Number.isSafeInteger(revision)) return void 0;
	const settings = decodeGrokSettings(value["settings"]);
	return settings === void 0 ? void 0 : {
		settings,
		revision
	};
}
function decodeGrokUsageReply(value) {
	if (!isRecord$10(value) || hasTokenFields(value)) return void 0;
	if (value["status"] === "unsupported") return { status: "unsupported" };
	if (value["status"] === "logged-out") return { status: "logged-out" };
	if (value["status"] !== "ok") return void 0;
	const usage = decodeGrokUsageView(value["usage"]);
	return usage === void 0 ? void 0 : {
		status: "ok",
		usage
	};
}
//#endregion
//#region lib/types/reasoning.js
/**
* Official Grok reasoning wire: Responses `reasoning.effort` is the
* models-v2 `reasoning_efforts[].value`. xAI documents
* `low` / `medium` / `high` (default) / `xhigh`, and reasoning cannot be
* disabled. `none`, `off`, and `summary` are not part of that request.
*/
/** Values the official Responses field `reasoning.effort` accepts today. */
const GROK_REASONING_WIRES = [
	"low",
	"medium",
	"high",
	"xhigh"
];
/** models-v2 `reasoning_effort` and the documented API default. */
const GROK_DEFAULT_REASONING_WIRE = "high";
const UNSUPPORTED = null;
/** grok-4.6 menu from GET /v1/models-v2 (`id`/`value`/`label`). */
const GROK_4_6_REASONING_EFFORTS = Object.freeze([
	Object.freeze({
		id: "xhigh",
		value: "xhigh",
		label: "Extra High Effort",
		description: "Highest effort and reasoning level"
	}),
	Object.freeze({
		id: "high",
		value: "high",
		label: "High Effort",
		description: "Higher implementation quality with extensive reasoning"
	}),
	Object.freeze({
		id: "medium",
		value: "medium",
		label: "Medium Effort",
		description: "Balanced effort with standard implementation and testing"
	}),
	Object.freeze({
		id: "low",
		value: "low",
		label: "Low Effort",
		description: "Quick, fast implementations"
	})
]);
/** grok-4.5 menu: same wire values minus `xhigh`. */
const GROK_4_5_REASONING_EFFORTS = Object.freeze(GROK_4_6_REASONING_EFFORTS.filter((effort) => effort.value !== "xhigh"));
function isRecord$9(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Whether `value` is an official `reasoning.effort` spelling. */
function isGrokReasoningWire(value) {
	return GROK_REASONING_WIRES.includes(value);
}
/**
* Official advertised efforts for one catalog row. Live models-v2 rows win;
* otherwise the frozen per-id menu is used.
*/
function officialEffortsFor(model) {
	if (model.reasoningEfforts !== void 0 && model.reasoningEfforts.length > 0) return model.reasoningEfforts;
	return model.id === "grok-4.5" ? GROK_4_5_REASONING_EFFORTS : GROK_4_6_REASONING_EFFORTS;
}
/** Official default `reasoning.effort` for one catalog row. */
function officialDefaultEffort(model) {
	const values = new Set(officialEffortsFor(model).map((effort) => effort.value));
	const configured = model.defaultReasoningEffort;
	if (configured !== void 0 && values.has(configured) && isGrokReasoningWire(configured)) return configured;
	if (values.has("high")) return GROK_DEFAULT_REASONING_WIRE;
	for (const effort of officialEffortsFor(model)) if (isGrokReasoningWire(effort.value)) return effort.value;
	return GROK_DEFAULT_REASONING_WIRE;
}
/**
* Pin every pi-ai level. Advertised official values are sent as themselves;
* everything else, including Off, is unsupported so we never emit `none`.
*/
function grokThinkingLevelMap(model) {
	const values = new Set(officialEffortsFor(model).map((effort) => effort.value));
	return {
		off: UNSUPPORTED,
		minimal: UNSUPPORTED,
		low: values.has("low") ? "low" : UNSUPPORTED,
		medium: values.has("medium") ? "medium" : UNSUPPORTED,
		high: values.has("high") ? "high" : UNSUPPORTED,
		xhigh: values.has("xhigh") ? "xhigh" : UNSUPPORTED,
		max: UNSUPPORTED
	};
}
/**
* Map a selector id or already-resolved wire value onto models-v2 `value`.
* Unknown, `none`, and `off` become the official default.
*/
function resolveGrokReasoningWire(requested, model) {
	const efforts = officialEffortsFor(model);
	const fallback = officialDefaultEffort(model);
	if (typeof requested !== "string" || requested.length === 0) return fallback;
	for (const effort of efforts) if (effort.value === requested || effort.id === requested) return isGrokReasoningWire(effort.value) ? effort.value : fallback;
	return fallback;
}
/**
* Force the outbound Responses body onto official `reasoning: { effort }`.
* Drops `summary` (not in the official Grok request) and never sends `none`.
*/
function applyGrokReasoningWire(payload, model) {
	if (!isRecord$9(payload) || model.thinking !== true) return payload;
	const effort = resolveGrokReasoningWire((isRecord$9(payload["reasoning"]) ? payload["reasoning"] : void 0)?.["effort"], model);
	return {
		...payload,
		reasoning: { effort }
	};
}
//#endregion
//#region lib/types/session.js
/**
* Host-only Grok OAuth session file. Tokens never leave this module through
* the RPC contract; the browser only sees {@link statusFromSession}.
*/
/** File name under `$DSH_HOME`. Never `~/.grok/auth.json`. */
const GROK_SESSION_FILENAME = "grok-oauth.json";
function isRecord$8(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve `$DSH_HOME` from the launch-environment snapshot, then `~/.dsh`.
* @param ctx - Host plugin context that may carry a launcher snapshot.
* @returns the absolute session file path.
*/
function resolveGrokSessionPath(ctx) {
	const fromEnv = launchEnvironmentOf(ctx).get("DSH_HOME")?.value;
	const home = fromEnv !== void 0 && fromEnv.trim().length > 0 ? expandHome(fromEnv.trim()) : join(homedir(), ".dsh");
	return join(home, GROK_SESSION_FILENAME);
}
/**
* Build the session path under an already-resolved harness home.
* @param dshHome - absolute or home-relative harness home.
*/
function sessionPathForHome(dshHome) {
	return join(dshHome, GROK_SESSION_FILENAME);
}
/**
* Narrow a session document. Rejects missing token or expiry fields.
* @param value - parsed JSON.
*/
function decodeGrokSession(value) {
	if (!isRecord$8(value)) return void 0;
	const accessToken = value["accessToken"];
	const refreshToken = value["refreshToken"];
	const expiresAt = value["expiresAt"];
	const email = value["email"];
	const userId = value["userId"];
	if (typeof accessToken !== "string" || accessToken.length === 0) return void 0;
	if (typeof refreshToken !== "string" || refreshToken.length === 0) return void 0;
	if (typeof expiresAt !== "string" || expiresAt.length === 0 || Number.isNaN(Date.parse(expiresAt))) return;
	if (email !== void 0 && (typeof email !== "string" || email.length === 0)) return void 0;
	if (userId !== void 0 && (typeof userId !== "string" || userId.length === 0)) return void 0;
	return {
		accessToken,
		refreshToken,
		expiresAt,
		...email === void 0 ? {} : { email },
		...userId === void 0 ? {} : { userId }
	};
}
/**
* Read the session file. Missing or corrupt documents are treated as signed-out.
* @param path - absolute session path.
*/
async function readSession(path) {
	try {
		const raw = await readFile(path, "utf8");
		return decodeGrokSession(JSON.parse(raw));
	} catch {
		return;
	}
}
/**
* Atomically write the session file with mode `0600`.
* @param path - absolute session path.
* @param session - tokens and account identity.
*/
async function writeSession(path, session) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
	const body = `${JSON.stringify(session, null, 2)}\n`;
	try {
		await writeFile(tmp, body, {
			encoding: "utf8",
			mode: 384
		});
		await chmod(tmp, 384);
		await rename(tmp, path);
		await chmod(path, 384);
	} catch (error) {
		await unlink(tmp).catch(() => void 0);
		throw error;
	}
}
/**
* Delete the session file. Missing files are success.
* @param path - absolute session path.
*/
async function deleteSession(path) {
	try {
		await unlink(path);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
/**
* Project a Host session into the secret-free RPC status view.
* @param session - current session, if any.
*/
function statusFromSession(session) {
	if (session === void 0) return { loggedIn: false };
	return {
		loggedIn: true,
		...session.email === void 0 ? {} : { email: session.email },
		expiresAt: session.expiresAt
	};
}
//#endregion
//#region lib/types/oauth.js
/**
* Host-owned xAI PKCE (S256) against the Grok CLI public client.
* Tokens stay on the Host; this module never logs Authorization headers.
*/
/** Issuer used by the Grok CLI public client. */
const GROK_OAUTH_ISSUER = "https://auth.x.ai";
/** Public client_id from the Grok CLI auth.json key `https://auth.x.ai::<client_id>`. */
const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/**
* Scopes the official Grok CLI requests. `grok-cli:access` is what
* cli-chat-proxy billing and chat treat as a CLI token; `api:access` alone
* signs in but is rejected as "must be performed by Grok CLI token users".
*/
const GROK_OAUTH_SCOPE = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"grok-cli:access",
	"api:access"
].join(" ");
/** Pinned authorize path when OIDC discovery is unavailable. */
const GROK_OAUTH_AUTHORIZE_PATH = "/oauth2/authorize";
/** Pinned token path when OIDC discovery is unavailable. */
const GROK_OAUTH_TOKEN_PATH = "/oauth2/token";
/** How long the loopback listener waits for the browser callback. */
const GROK_OAUTH_TIMEOUT_MS = 3e5;
/** Refresh when the access token expires within this window. */
const GROK_OAUTH_REFRESH_SKEW_MS = 6e4;
function isRecord$7(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function retryable(message) {
	return {
		ok: false,
		retryable: true,
		message
	};
}
function randomUrlSafe(bytes) {
	return randomBytes(bytes).toString("base64url");
}
/** PKCE S256 pair plus a CSRF state. */
function createPkcePair() {
	const verifier = randomUrlSafe(32);
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url"),
		state: randomUrlSafe(16)
	};
}
function decodeJwtPayload(token) {
	const parts = token.split(".");
	const payload = parts[1];
	if (parts.length < 2 || payload === void 0) return void 0;
	try {
		const json = Buffer.from(payload, "base64url").toString("utf8");
		const value = JSON.parse(json);
		return isRecord$7(value) ? value : void 0;
	} catch {
		return;
	}
}
function joinUrl(issuer, path) {
	return `${issuer.replace(/\/+$/u, "")}${path}`;
}
/**
* Discover authorize/token endpoints, falling back to the Grok CLI paths.
* @param issuer - OIDC issuer origin.
* @param fetchImpl - HTTP client.
*/
async function discoverOidcEndpoints(issuer, fetchImpl = fetch) {
	const fallback = {
		authorizationEndpoint: joinUrl(issuer, GROK_OAUTH_AUTHORIZE_PATH),
		tokenEndpoint: joinUrl(issuer, GROK_OAUTH_TOKEN_PATH)
	};
	try {
		const response = await fetchImpl(joinUrl(issuer, "/.well-known/openid-configuration"), { headers: { accept: "application/json" } });
		if (!response.ok) return fallback;
		const body = await response.json();
		if (!isRecord$7(body)) return fallback;
		const authorizationEndpoint = body["authorization_endpoint"];
		const tokenEndpoint = body["token_endpoint"];
		const userinfoEndpoint = body["userinfo_endpoint"];
		if (typeof authorizationEndpoint !== "string" || authorizationEndpoint.length === 0) return fallback;
		if (typeof tokenEndpoint !== "string" || tokenEndpoint.length === 0) return fallback;
		return {
			authorizationEndpoint,
			tokenEndpoint,
			...typeof userinfoEndpoint === "string" && userinfoEndpoint.length > 0 ? { userinfoEndpoint } : {}
		};
	} catch {
		return fallback;
	}
}
function spawnDetached(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "ignore",
			detached: true
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
/** Open the authorize URL with xdg-open, then sensible-open. */
async function openSystemBrowser(url) {
	if (!/^https?:\/\//u.test(url)) throw new Error("refusing to open a non-http url");
	const commands = ["xdg-open", "sensible-open"];
	let last;
	for (const command of commands) try {
		await spawnDetached(command, [url]);
		return;
	} catch (error) {
		last = error;
	}
	throw last instanceof Error ? last : /* @__PURE__ */ new Error("could not open a system browser");
}
/**
* Fill production defaults for the Host OAuth runtime.
* @param overrides - required session path plus optional test fakes.
*/
function createGrokAuthRuntime(overrides) {
	return {
		issuer: GROK_OAUTH_ISSUER,
		clientId: GROK_OAUTH_CLIENT_ID,
		scope: GROK_OAUTH_SCOPE,
		openBrowser: openSystemBrowser,
		fetch,
		now: () => Date.now(),
		timeoutMs: GROK_OAUTH_TIMEOUT_MS,
		refreshSkewMs: GROK_OAUTH_REFRESH_SKEW_MS,
		...overrides
	};
}
function readString(record, key) {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function expiresAtFromTokens(body, now) {
	const expiresIn = body["expires_in"];
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) return new Date(now + expiresIn * 1e3).toISOString();
	for (const token of [body["id_token"], body["access_token"]]) {
		if (typeof token !== "string") continue;
		const exp = decodeJwtPayload(token)?.["exp"];
		if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) return (/* @__PURE__ */ new Date(exp * 1e3)).toISOString();
	}
	return new Date(now).toISOString();
}
async function accountFromTokens(body, accessToken, userinfoEndpoint, fetchImpl) {
	const idToken = readString(body, "id_token");
	const claims = idToken === void 0 ? void 0 : decodeJwtPayload(idToken);
	let email = claims !== void 0 ? readString(claims, "email") : void 0;
	let userId = claims !== void 0 ? readString(claims, "sub") : void 0;
	if ((email === void 0 || userId === void 0) && userinfoEndpoint !== void 0) try {
		const response = await fetchImpl(userinfoEndpoint, { headers: {
			authorization: `Bearer ${accessToken}`,
			accept: "application/json"
		} });
		if (response.ok) {
			const info = await response.json();
			if (isRecord$7(info)) {
				email ??= readString(info, "email");
				userId ??= readString(info, "sub");
			}
		}
	} catch {}
	return {
		...email === void 0 ? {} : { email },
		...userId === void 0 ? {} : { userId }
	};
}
async function parseTokenResponse(response, now, userinfoEndpoint, fetchImpl, previous) {
	if (!response.ok) return void 0;
	let body;
	try {
		body = await response.json();
	} catch {
		return;
	}
	if (!isRecord$7(body)) return void 0;
	const accessToken = readString(body, "access_token");
	const refreshToken = readString(body, "refresh_token") ?? previous?.refreshToken;
	if (accessToken === void 0 || refreshToken === void 0) return void 0;
	const account = await accountFromTokens(body, accessToken, userinfoEndpoint, fetchImpl);
	const email = account.email ?? previous?.email;
	const userId = account.userId ?? previous?.userId;
	return {
		accessToken,
		refreshToken,
		expiresAt: expiresAtFromTokens(body, now),
		...email === void 0 ? {} : { email },
		...userId === void 0 ? {} : { userId }
	};
}
/**
* Exchange a refresh token. Callers delete the session when this returns undefined.
* @param runtime - Host OAuth runtime.
* @param session - current session.
*/
async function refreshSession(runtime, session) {
	const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch);
	let response;
	try {
		response = await runtime.fetch(endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json"
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: session.refreshToken,
				client_id: runtime.clientId
			})
		});
	} catch {
		return;
	}
	return parseTokenResponse(response, runtime.now(), endpoints.userinfoEndpoint, runtime.fetch, session);
}
/**
* Return a session that is not near expiry, refreshing or clearing as needed.
* @param runtime - Host OAuth runtime.
*/
async function ensureFreshSession(runtime) {
	const path = runtime.resolveSessionPath();
	const session = await readSession(path);
	if (session === void 0) return void 0;
	if (Date.parse(session.expiresAt) - runtime.now() > runtime.refreshSkewMs) return session;
	const refreshed = await refreshSession(runtime, session);
	if (refreshed === void 0) {
		await deleteSession(path);
		return;
	}
	await writeSession(path, refreshed);
	return refreshed;
}
const CALLBACK_OK = "<!doctype html><title>Grok</title><p>Sign-in complete. You can close this window.</p>";
const CALLBACK_FAIL = "<!doctype html><title>Grok</title><p>Sign-in did not complete. You can close this window and try again.</p>";
function listenLoopback() {
	const server = createServer();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close();
				reject(/* @__PURE__ */ new Error("loopback listener has no port"));
				return;
			}
			resolve({
				server,
				port: address.port
			});
		});
	});
}
function closeServer(server) {
	return new Promise((resolve) => {
		server.close(() => resolve());
	});
}
function waitForCallback(server, expectedState, timeoutMs, signal) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			server.removeListener("request", onRequest);
			if (result instanceof Error) reject(result);
			else resolve(result);
		};
		const onAbort = () => {
			finish(Object.assign(/* @__PURE__ */ new Error("Sign-in was cancelled."), { code: "ABORT_ERR" }));
		};
		const timer = setTimeout(() => {
			finish(Object.assign(/* @__PURE__ */ new Error("Sign-in timed out."), { code: "TIMEOUT" }));
		}, timeoutMs);
		const onRequest = (request, response) => {
			try {
				const url = new URL(request.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== "/callback") {
					response.writeHead(404, { "content-type": "text/plain" }).end("not found");
					return;
				}
				const state = url.searchParams.get("state");
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");
				if (state !== expectedState) {
					response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(CALLBACK_FAIL);
					finish({ kind: "mismatch" });
					return;
				}
				if (error !== null || code === null || code.length === 0) {
					response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(CALLBACK_FAIL);
					finish({ kind: "denied" });
					return;
				}
				response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(CALLBACK_OK);
				finish({
					kind: "code",
					code
				});
			} catch (error) {
				response.writeHead(400).end();
				finish(error instanceof Error ? error : /* @__PURE__ */ new Error("invalid callback"));
			}
		};
		if (signal?.aborted === true) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		server.on("request", onRequest);
	});
}
const loginInFlight = /* @__PURE__ */ new WeakSet();
const pendingPaste = /* @__PURE__ */ new WeakMap();
function createPendingPaste() {
	let deliver = () => void 0;
	const wait = new Promise((resolve) => {
		deliver = resolve;
	});
	return {
		deliver,
		wait
	};
}
/**
* Run one loopback PKCE sign-in. Cancel, timeout, and state mismatch leave
* the session file untouched.
* @param runtime - Host OAuth runtime.
* @param signal - RPC abort signal.
*/
async function startPkceLogin(runtime, signal) {
	if (loginInFlight.has(runtime)) return retryable("Sign-in is already in progress.");
	loginInFlight.add(runtime);
	let server;
	const local = new AbortController();
	const onParentAbort = () => {
		local.abort();
	};
	signal?.addEventListener("abort", onParentAbort);
	try {
		if (signal?.aborted === true || local.signal.aborted) return retryable("Sign-in was cancelled.");
		const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch);
		const listener = await listenLoopback();
		server = listener.server;
		const pkce = createPkcePair();
		const redirectUri = `http://127.0.0.1:${String(listener.port)}/callback`;
		const authorize = new URL(endpoints.authorizationEndpoint);
		authorize.searchParams.set("response_type", "code");
		authorize.searchParams.set("client_id", runtime.clientId);
		authorize.searchParams.set("redirect_uri", redirectUri);
		authorize.searchParams.set("scope", runtime.scope);
		authorize.searchParams.set("state", pkce.state);
		authorize.searchParams.set("nonce", randomUrlSafe(18));
		authorize.searchParams.set("referrer", "grok-build");
		authorize.searchParams.set("code_challenge", pkce.challenge);
		authorize.searchParams.set("code_challenge_method", "S256");
		const paste = createPendingPaste();
		pendingPaste.set(runtime, paste);
		const callback = waitForCallback(server, pkce.state, runtime.timeoutMs, local.signal);
		try {
			await runtime.openBrowser(authorize.toString());
		} catch {
			local.abort();
			await callback.catch(() => void 0);
			return retryable("Sign-in could not be completed.");
		}
		const pasted = paste.wait.then((code) => ({
			kind: "code",
			code
		}));
		const result = await Promise.race([callback, pasted]);
		if (result.kind === "mismatch") return retryable("Sign-in rejected a mismatched state.");
		if (result.kind === "denied") return retryable("Sign-in did not complete.");
		const session = await parseTokenResponse(await runtime.fetch(endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json"
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: result.code,
				redirect_uri: redirectUri,
				client_id: runtime.clientId,
				code_verifier: pkce.verifier
			})
		}), runtime.now(), endpoints.userinfoEndpoint, runtime.fetch);
		if (session === void 0) return retryable("Sign-in could not be completed.");
		await writeSession(runtime.resolveSessionPath(), session);
		return { ok: true };
	} catch (error) {
		const code = error.code;
		if (code === "ABORT_ERR" || signal?.aborted === true || local.signal.aborted) return retryable("Sign-in was cancelled.");
		if (code === "TIMEOUT") return retryable("Sign-in timed out.");
		return retryable("Sign-in could not be completed.");
	} finally {
		signal?.removeEventListener("abort", onParentAbort);
		if (server !== void 0) await closeServer(server);
		pendingPaste.delete(runtime);
		loginInFlight.delete(runtime);
	}
}
const remoteAttempts = /* @__PURE__ */ new Map();
async function beginPkceLogin(runtime) {
	let attempts = remoteAttempts.get(runtime);
	if (attempts === void 0) {
		attempts = /* @__PURE__ */ new Map();
		remoteAttempts.set(runtime, attempts);
	}
	for (const [id, attempt] of attempts) if (attempt.status !== "pending" || attempt.expiresAt <= runtime.now()) {
		if (attempt.status === "pending") statusPkceLogin(runtime, id);
		if (attempt.status !== "pending") attempts.delete(id);
	}
	if ([...attempts.values()].some((attempt) => attempt.completing)) return retryable("Sign-in is already completing.");
	for (const id of [...attempts.keys()]) cancelPkceLogin(runtime, id);
	const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch);
	const pkce = createPkcePair();
	const attemptId = randomUrlSafe(18);
	const listener = await listenLoopback();
	const redirectUri = `http://127.0.0.1:${String(listener.port)}/callback`;
	const cancellation = new AbortController();
	const url = new URL(endpoints.authorizationEndpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", runtime.clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", runtime.scope);
	url.searchParams.set("state", pkce.state);
	url.searchParams.set("nonce", randomUrlSafe(18));
	url.searchParams.set("referrer", "grok-build");
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	attempts.set(attemptId, {
		verifier: pkce.verifier,
		redirectUri,
		endpoints,
		expiresAt: runtime.now() + runtime.timeoutMs,
		server: listener.server,
		cancellation,
		status: "pending",
		completing: false
	});
	waitForCallback(listener.server, pkce.state, runtime.timeoutMs, cancellation.signal).then(async (result) => {
		if (result.kind === "code") await completePkceLogin(runtime, attemptId, result.code);
		else cancelPkceLogin(runtime, attemptId);
	}).catch(() => {
		cancelPkceLogin(runtime, attemptId);
	});
	return {
		attemptId,
		authorizationUrl: url.toString()
	};
}
function cancelPkceLogin(runtime, attemptId) {
	const attempt = remoteAttempts.get(runtime)?.get(attemptId);
	if (attempt === void 0 || attempt.status !== "pending") return false;
	attempt.status = "cancelled";
	attempt.cancellation.abort();
	closeServer(attempt.server);
	return true;
}
function cancelAllPkceLogins(runtime) {
	const attempts = remoteAttempts.get(runtime);
	if (attempts === void 0) return;
	for (const id of [...attempts.keys()]) cancelPkceLogin(runtime, id);
	attempts.clear();
	remoteAttempts.delete(runtime);
}
function statusPkceLogin(runtime, attemptId) {
	const attempt = remoteAttempts.get(runtime)?.get(attemptId);
	if (attempt === void 0) return "missing";
	if (attempt.status === "pending" && attempt.expiresAt <= runtime.now()) {
		attempt.status = "expired";
		attempt.cancellation.abort();
		closeServer(attempt.server);
	}
	return attempt.status;
}
async function completePkceLogin(runtime, codeOrAttemptId, remoteCode) {
	if (remoteCode !== void 0) {
		const attemptId = codeOrAttemptId;
		const code = remoteCode.trim();
		const attempt = remoteAttempts.get(runtime)?.get(attemptId);
		if (attempt === void 0) return retryable("Sign-in attempt is missing or expired.");
		if (attempt.status !== "pending") return retryable("Sign-in attempt is no longer active.");
		if (attempt.expiresAt <= runtime.now()) {
			statusPkceLogin(runtime, attemptId);
			return retryable("Sign-in attempt expired.");
		}
		if (code.length === 0) return retryable("Paste the sign-in code from the browser page.");
		if (attempt.completing) return retryable("Sign-in is already completing.");
		attempt.completing = true;
		try {
			const session = await parseTokenResponse(await runtime.fetch(attempt.endpoints.tokenEndpoint, {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					accept: "application/json"
				},
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					redirect_uri: attempt.redirectUri,
					client_id: runtime.clientId,
					code_verifier: attempt.verifier
				})
			}), runtime.now(), attempt.endpoints.userinfoEndpoint, runtime.fetch);
			if (session === void 0) {
				attempt.status = "failed";
				attempt.cancellation.abort();
				closeServer(attempt.server);
				return retryable("Sign-in could not be completed.");
			}
			await writeSession(runtime.resolveSessionPath(), session);
			attempt.status = "succeeded";
			attempt.cancellation.abort();
			closeServer(attempt.server);
			return { ok: true };
		} catch {
			attempt.status = "failed";
			attempt.cancellation.abort();
			closeServer(attempt.server);
			return retryable("Sign-in could not be completed.");
		}
	}
	const trimmed = codeOrAttemptId.trim();
	if (trimmed.length === 0) return retryable("Paste the sign-in code from the browser page.");
	const pending = pendingPaste.get(runtime);
	if (pending === void 0) return retryable("Sign-in is not waiting for a code.");
	pending.deliver(trimmed);
	return { ok: true };
}
/** Headers attached to every cli-chat-proxy request this plugin makes. */
const GROK_CLI_REQUEST_HEADERS = Object.freeze({
	"x-grok-client-version": "1.0.4",
	"x-grok-client-identifier": "grok-shell"
});
//#endregion
//#region lib/types/server-search-calls.js
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
/** Grok server-search call_id prefixes observed on cli-chat-proxy. */
const GROK_SERVER_SEARCH_CALL_PREFIXES = [
	"xs_call-",
	"ws_call-",
	"web_search_call-"
];
function isRecord$6(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* True when this tool-call id is a Grok server search echo, not a DSH
* function. The id is `call_id|item_id`; only the call_id prefix matters.
*/
function isGrokServerSearchToolCallId(id) {
	if (id === void 0 || id.length === 0) return false;
	const callId = id.split("|")[0] ?? id;
	return GROK_SERVER_SEARCH_CALL_PREFIXES.some((prefix) => callId.startsWith(prefix));
}
function toolCallFromEvent(event) {
	if (event.type === "toolcall_end") return {
		id: event.toolCall.id,
		name: event.toolCall.name
	};
	if (event.type !== "toolcall_start" && event.type !== "toolcall_delta") return void 0;
	const block = event.partial.content[event.contentIndex];
	if (!isRecord$6(block) || block["type"] !== "toolCall") return void 0;
	const id = typeof block["id"] === "string" ? block["id"] : void 0;
	const name = typeof block["name"] === "string" ? block["name"] : void 0;
	if (id === void 0 || name === void 0) return void 0;
	return {
		id,
		name
	};
}
/** Strip server-search echoes and relax `toolUse` when nothing else remains. */
function stripGrokServerSearchToolCalls(message) {
	const content = message.content.filter((block) => !(block.type === "toolCall" && isGrokServerSearchToolCallId(block.id)));
	if (content.length === message.content.length) return message;
	const stillCalling = content.some((block) => block.type === "toolCall");
	const stopReason = message.stopReason === "toolUse" && !stillCalling ? "stop" : message.stopReason;
	return {
		...message,
		content,
		stopReason
	};
}
/** Hold server-search toolcall_* events off the DSH stream. */
var GrokServerSearchCallFilter = class {
	hidden = /* @__PURE__ */ new Set();
	/** Map one upstream event to the events DSH should see. */
	take(event) {
		switch (event.type) {
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end": {
				if (this.hidden.has(event.contentIndex)) return [];
				const call = toolCallFromEvent(event);
				if (call !== void 0 && isGrokServerSearchToolCallId(call.id)) {
					this.hidden.add(event.contentIndex);
					return [];
				}
				return [event];
			}
			case "done": {
				const message = stripGrokServerSearchToolCalls(event.message);
				const reason = message.stopReason === "stop" || message.stopReason === "length" || message.stopReason === "toolUse" ? message.stopReason : event.reason;
				return [{
					...event,
					message,
					reason
				}];
			}
			case "error": return [{
				...event,
				error: stripGrokServerSearchToolCalls(event.error)
			}];
			default: return [event];
		}
	}
};
//#endregion
//#region lib/types/reasoning-display.js
/**
* Grok Responses returns many `type: reasoning` items that are not Think
* text: encrypted replay blobs, including server-side web_search / x_search
* outputs with `tco_*` ids and empty `summary`. pi-ai turns each one into a
* thinking block, so the Web GUI paints a stack of empty Think rows.
*
* Visible thinking stays a normal block. Opaque items are packed into that
* block's thinkingSignature and expanded back onto the next request's
* `input` so store:false replay still sees every encrypted item, in order.
*/
/** Tagged thinkingSignature / input item holding several Grok reasoning items. */
const GROK_PACKED_REASONING_TYPE = "dsh-grok-packed-reasoning";
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Whether this text should become a Think row. Whitespace-only is not visible. */
function isDisplayableThinking(text) {
	return (text ?? "").trim().length > 0;
}
/** Whether `value` is a pack this plugin wrote and must expand before send. */
function isGrokPackedReasoning(value) {
	if (!isRecord$5(value) || value["type"] !== "dsh-grok-packed-reasoning") return false;
	return Array.isArray(value["items"]);
}
function unpackSignature(raw) {
	if (raw === void 0 || raw.length === 0) return [];
	try {
		const parsed = JSON.parse(raw);
		if (isGrokPackedReasoning(parsed)) return parsed.items;
		return [parsed];
	} catch {
		return [];
	}
}
function withPackedSignature(block, items) {
	if (items.length === 0) return block;
	if (items.length === 1 && !isGrokPackedReasoning(items[0])) return {
		...block,
		thinkingSignature: JSON.stringify(items[0])
	};
	const packed = {
		type: GROK_PACKED_REASONING_TYPE,
		items
	};
	return {
		...block,
		thinkingSignature: JSON.stringify(packed)
	};
}
/**
* Drop empty thinking blocks from visible content and attach their signatures
* to the first displayable thinking block (or one empty carrier if none).
*/
function packGrokThinkingBlocks(content) {
	const leading = [];
	const out = [];
	let carrierIndex = -1;
	for (const block of content) {
		if (block.type !== "thinking") {
			out.push(block);
			continue;
		}
		const items = unpackSignature(block.thinkingSignature);
		if (isDisplayableThinking(block.thinking)) {
			const packed = withPackedSignature(block, [...leading, ...items]);
			leading.length = 0;
			carrierIndex = out.length;
			out.push(packed);
			continue;
		}
		leading.push(...items.length > 0 ? items : [{
			type: "reasoning",
			summary: []
		}]);
	}
	if (leading.length === 0) return out;
	if (carrierIndex >= 0) {
		const carrier = out[carrierIndex];
		if (carrier !== void 0) out[carrierIndex] = withPackedSignature(carrier, [...unpackSignature(carrier.thinkingSignature), ...leading]);
		return out;
	}
	const first = content.find((block) => block.type === "thinking");
	if (first === void 0) return out;
	out.unshift(withPackedSignature(first, leading));
	return out;
}
/**
* Replace packed reasoning items in a Responses `input` with the original
* Grok items, in the order they were packed.
*/
function expandPackedGrokReasoningInput(payload) {
	if (!isRecord$5(payload) || !Array.isArray(payload["input"])) return payload;
	const input = [];
	for (const item of payload["input"]) if (isGrokPackedReasoning(item)) input.push(...item.items);
	else input.push(item);
	return {
		...payload,
		input
	};
}
/** Hold empty thinking_start/end off the wire and pack the final message. */
var GrokThinkingFilter = class {
	heldStarts = /* @__PURE__ */ new Map();
	opened = /* @__PURE__ */ new Set();
	/** Map one upstream event to the events DSH should see. */
	take(event) {
		switch (event.type) {
			case "thinking_start":
				this.heldStarts.set(event.contentIndex, event);
				return [];
			case "thinking_delta":
				if (!isDisplayableThinking(event.delta) && !this.opened.has(event.contentIndex)) return [];
				return this.openAnd(event);
			case "thinking_end":
				if (!isDisplayableThinking(event.content) && !this.opened.has(event.contentIndex)) {
					this.heldStarts.delete(event.contentIndex);
					return [];
				}
				return this.openAnd(event);
			case "done": return [{
				...event,
				message: packAssistant(event.message)
			}];
			case "error": return [{
				...event,
				error: packAssistant(event.error)
			}];
			default: return [event];
		}
	}
	openAnd(event) {
		const forwarded = [];
		const held = this.heldStarts.get(event.contentIndex);
		if (held !== void 0 && !this.opened.has(event.contentIndex)) forwarded.push(held);
		this.heldStarts.delete(event.contentIndex);
		this.opened.add(event.contentIndex);
		forwarded.push(event);
		return forwarded;
	}
};
function packAssistant(message) {
	return {
		...message,
		content: packGrokThinkingBlocks(message.content)
	};
}
/**
* Forward a pi-ai Responses stream with empty Grok reasoning hidden from DSH
* and packed onto the terminal assistant message.
*/
function filterGrokThinkingStream(inner) {
	const out = createAssistantMessageEventStream();
	pumpGrokThinkingStream(inner, out);
	return out;
}
async function pumpGrokThinkingStream(inner, out) {
	const search = new GrokServerSearchCallFilter();
	const thinking = new GrokThinkingFilter();
	try {
		for await (const event of inner) for (const afterSearch of search.take(event)) for (const next of thinking.take(afterSearch)) out.push(next);
	} finally {
		out.end();
	}
}
//#endregion
//#region lib/types/responses-tools.js
/**
* Inject xAI server-side search tools into an outbound Responses body.
* Pi-ai only emits `{ type: "function" }` tools; the proxy runs web_search
* and x_search itself. Search results come back as encrypted `type: reasoning`
* items (`tco_*`) with empty summaries — packed off the Think UI, replayed
* on the next request. This is not a `ctx.web` provider.
*/
/** Server-side search tools the Grok CLI chat proxy accepts on every request. */
const GROK_SERVER_SEARCH_TOOLS = [{ type: "web_search" }, { type: "x_search" }];
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toolType(tool) {
	if (!isRecord$4(tool)) return void 0;
	return typeof tool["type"] === "string" ? tool["type"] : void 0;
}
function toolName(tool) {
	if (!isRecord$4(tool)) return void 0;
	return typeof tool["name"] === "string" ? tool["name"] : void 0;
}
function occupiesServerTool(tool, type) {
	return toolType(tool) === type || toolName(tool) === type;
}
/**
* Append `{ type: "web_search" }` and `{ type: "x_search" }` when missing.
* Leaves non-object payloads unchanged.
* @param payload - the Responses `create` body pi-ai is about to send.
*/
function injectGrokServerSearchTools(payload) {
	if (!isRecord$4(payload)) return payload;
	const existing = payload["tools"];
	const tools = Array.isArray(existing) ? [...existing] : [];
	for (const extra of GROK_SERVER_SEARCH_TOOLS) if (!tools.some((tool) => occupiesServerTool(tool, extra.type))) tools.push({ type: extra.type });
	return {
		...payload,
		tools
	};
}
function catalogFor(model, models) {
	return models.find((entry) => entry.id === model.id) ?? {
		id: model.id,
		thinking: model.reasoning
	};
}
function withGrokResponsesBody(streamFn, models) {
	return (model, context, options) => {
		const original = options?.onPayload;
		return streamFn(model, context, {
			...options,
			onPayload: async (payload, nextModel) => {
				const next = original === void 0 ? payload : await original(payload, nextModel);
				return expandPackedGrokReasoningInput(applyGrokReasoningWire(injectGrokServerSearchTools(next === void 0 ? payload : next), catalogFor(nextModel, models)));
			}
		});
	};
}
/**
* OpenAI Responses streams with Grok server-side search tools and official
* `reasoning.effort` patched in. Wrapping `onPayload` is required because
* pi-ai's client has no custom fetch.
*/
function withHiddenOpaqueThinking(streamFn) {
	return (model, context, options) => filterGrokThinkingStream(streamFn(model, context, options));
}
function grokResponsesApi(models = []) {
	const base = openAIResponsesApi();
	return {
		stream: withHiddenOpaqueThinking(withGrokResponsesBody(base.stream, models)),
		streamSimple: withHiddenOpaqueThinking(withGrokResponsesBody(base.streamSimple, models))
	};
}
//#endregion
//#region lib/types/pi-ai-profile.js
/**
* Translate the frozen Grok catalog into the pi-ai profile used for OpenAI
* Responses against the Grok CLI chat proxy.
*/
/** Chat proxy base used by the Grok CLI (`POST {base}/responses`). */
const GROK_CHAT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** Official Grok 4.6 / 4.5 context window; used when a row has none. */
const GROK_DEFAULT_CONTEXT_WINDOW = 5e5;
/** Safe output capability used when the frozen catalog entry has none. */
const GROK_DEFAULT_MODEL_MAX_TOKENS = 32768;
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
const { name: PACKAGE_NAME, version: PACKAGE_VERSION } = createRequire(import.meta.url)("../package.json");
/** Plugin identity sent beside the required CLI version headers. */
const GROK_PLUGIN_IDENTITY_HEADER = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
function proxyHeaders() {
	return {
		...GROK_CLI_REQUEST_HEADERS,
		"X-Dsh-Plugin": GROK_PLUGIN_IDENTITY_HEADER
	};
}
function thinkingLevelMap(model) {
	if (model.thinking !== true) return void 0;
	return grokThinkingLevelMap(model);
}
function toPiAiModel(model, baseUrl) {
	const levels = thinkingLevelMap(model);
	return {
		id: model.id,
		name: model.name ?? model.id,
		api: "openai-responses",
		provider: GROK_PROVIDER,
		baseUrl,
		reasoning: model.thinking === true,
		...levels === void 0 ? {} : { thinkingLevelMap: levels },
		input: model.vision === true ? ["text", "image"] : ["text"],
		cost: NO_COST,
		contextWindow: model.contextWindow ?? 5e5,
		maxTokens: model.maxTokens ?? 32768,
		compat: {
			supportsDeveloperRole: false,
			supportsLongCacheRetention: false,
			supportsStrictMode: false,
			supportsOpenAIGrammarTools: false,
			supportsToolSearch: false,
			supportsExplicitPromptCacheMode: false
		}
	};
}
/** Harness-authenticated provider auth; the access token is supplied per request. */
function grokAuth() {
	return { apiKey: {
		name: "Grok subscription",
		resolve: ({ credential }) => Promise.resolve({
			auth: credential?.key === void 0 ? {} : { apiKey: credential.key },
			source: "Grok"
		})
	} };
}
/** Resolve the complete pi-ai profile for one Grok options snapshot. */
function createGrokPiAiProfile(connection) {
	const baseURL = connection.baseURL.replace(/\/+$/u, "");
	const source = connection.models.length > 0 ? connection.models : GROK_CATALOG;
	const models = source.map((model) => toPiAiModel(model, baseURL));
	const configuredMaxTokens = /* @__PURE__ */ new Map();
	const headers = proxyHeaders();
	const piProvider = createProvider({
		id: GROK_PROVIDER,
		name: "Grok",
		baseUrl: baseURL,
		auth: grokAuth(),
		models,
		api: grokResponsesApi(source),
		headers
	});
	return {
		provider: GROK_PROVIDER,
		displayName: "Grok",
		baseURL,
		defaultContextWindow: GROK_DEFAULT_CONTEXT_WINDOW,
		defaultMaxTokens: GROK_DEFAULT_MODEL_MAX_TOKENS,
		defaultInput: ["text"],
		streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
		retryPolicy: connection.retryPolicy,
		/** Mirrors the official aggregate base64 image limit per request. */
		maxRequestImageBytes: 20971520,
		/** Request-image pixel budget used by the Alpha.4 attachment normalizer. */
		requestImagePixelBudget: 4194304,
		requestImageMaxBytes: 1048576,
		piProvider,
		configuredMaxTokens,
		headers
	};
}
//#endregion
//#region lib/types/pi-ai-auth.js
/**
* In-memory pi-ai auth injection for Grok's request-scoped subscription route.
*
* Grok resolves its access token through `resolveApiKey` for each request, so the
* store starts empty. It remains available for a future login flow without using
* pi-ai's per-collection default store.
*
* @module dsh-llm-grok/pi-ai-auth
*/
/**
* Create the auth injectables for a Grok pi-ai collection.
*
* The credential store retains records in memory for the lifetime of the
* returned injection. Ambient provider lookups are deliberately disabled.
*
* @returns an in-memory credential store and a finds-nothing auth context.
*/
function createGrokPiAiAuth() {
	const stored = /* @__PURE__ */ new Map();
	return {
		credentials: {
			read: (id) => Promise.resolve(stored.get(id)),
			list: () => Promise.resolve([...stored].map(([providerId, credential]) => ({
				providerId,
				type: credential.type
			}))),
			async modify(id, mutate) {
				const next = await mutate(stored.get(id));
				if (next !== void 0) stored.set(id, next);
				return stored.get(id);
			},
			delete: (id) => {
				stored.delete(id);
				return Promise.resolve();
			}
		},
		authContext: {
			env: () => Promise.resolve(void 0),
			fileExists: () => Promise.resolve(false)
		}
	};
}
//#endregion
//#region lib/types/adapter.js
/**
* Grok subscription chat adapter. The public route stays `grok`, while the
* wire implementation is delegated to pi-ai's OpenAI Responses support.
*/
/**
* Return the current access token, refreshing when the session is near expiry.
* A missing session is MISSING_CREDENTIAL. A session that existed but whose
* refresh failed (and was cleared) is AUTH.
* @param runtime - Host OAuth runtime.
*/
async function resolveGrokAccessToken(runtime) {
	const existing = await readSession(runtime.resolveSessionPath());
	const session = await ensureFreshSession(runtime);
	if (session === void 0) {
		if (existing !== void 0) throw new LlmError("llm-grok: session refresh failed; sign in again with an xAI subscription", "AUTH");
		throw new LlmError("llm-grok: not signed in; sign in with an xAI subscription from Plugin configuration", "MISSING_CREDENTIAL");
	}
	return session.accessToken;
}
/**
* Replace pi-ai's generated effort list with official models-v2 order, labels,
* and the documented default `reasoning.effort`.
*/
function applyOfficialReasoningMetadata(info, catalog) {
	if (info.reasoning === void 0 || catalog === void 0 || catalog.thinking !== true) return info;
	const supported = new Set(info.reasoning.efforts.map((effort) => effort.id));
	const efforts = officialEffortsFor(catalog).flatMap((effort) => {
		if (!isGrokReasoningWire(effort.value) || !supported.has(ReasoningEffortId(effort.value))) return [];
		return [{
			id: ReasoningEffortId(effort.value),
			name: effort.label ?? effort.value,
			...effort.description === void 0 ? {} : { description: effort.description }
		}];
	});
	if (efforts.length === 0) return info;
	const preferred = ReasoningEffortId(officialDefaultEffort(catalog));
	const defaultEffort = efforts.some((effort) => effort.id === preferred) ? preferred : efforts[0]?.id;
	return {
		...info,
		reasoning: {
			efforts,
			...defaultEffort === void 0 ? {} : { defaultEffort }
		}
	};
}
function classifyGrokTransientError(chunk) {
	if (chunk.type !== "finish" || chunk.reason.kind !== "error" || chunk.reason.failure.code !== "PI_AI_ERROR") return chunk;
	const message = chunk.reason.failure.message;
	const code = /currently at capacity|high demand/iu.test(message) ? "RATE_LIMIT" : /service temporarily unavailable|availability is currently degraded/iu.test(message) ? "SERVER" : void 0;
	if (code === void 0) return chunk;
	return {
		...chunk,
		reason: {
			...chunk.reason,
			failure: {
				...chunk.reason.failure,
				code
			}
		}
	};
}
const SANDBOX_MODE_RANK = {
	"read-only": 0,
	"workspace-write": 1,
	"danger-full-access": 2
};
/**
* Remove sandbox escalation choices that cannot be strictly wider than the
* current DSH policy. Core still validates every retained request; this only
* prevents Grok from selecting an impossible optional enum value.
* Scans both options.system and DSH context-injection messages.
*/
function narrowGrokEscalationSchemas(options) {
	const mode = sandboxModeOf(options);
	const currentRank = mode === void 0 ? void 0 : SANDBOX_MODE_RANK[mode];
	if (currentRank === void 0 || options.tools === void 0) return options;
	let changed = false;
	const tools = options.tools.map((tool) => {
		const parameters = tool.parameters;
		const properties = isRecord$3(parameters.properties) ? parameters.properties : void 0;
		const permission = properties === void 0 || !isRecord$3(properties.sandbox_permissions) ? void 0 : properties.sandbox_permissions;
		if (permission === void 0 || !Array.isArray(permission.enum)) return tool;
		const wider = permission.enum.filter((candidate) => {
			return typeof candidate === "string" && (SANDBOX_MODE_RANK[candidate] ?? -1) > currentRank;
		});
		if (wider.length === permission.enum.length) return tool;
		changed = true;
		const nextProperties = { ...properties };
		if (wider.length === 0) {
			delete nextProperties.sandbox_permissions;
			delete nextProperties.justification;
		} else nextProperties.sandbox_permissions = {
			...permission,
			enum: wider
		};
		const required = Array.isArray(parameters.required) ? parameters.required.filter((name) => name !== "sandbox_permissions" && name !== "justification") : void 0;
		return {
			...tool,
			parameters: {
				...parameters,
				properties: nextProperties,
				...required === void 0 ? {} : { required }
			}
		};
	});
	return changed ? {
		...options,
		tools
	} : options;
}
function sandboxModeOf(options) {
	for (let index = options.messages.length - 1; index >= 0; index -= 1) {
		const message = options.messages[index];
		if (!isRecord$3(message)) continue;
		const found = sandboxModeIn(message.content);
		if (found !== void 0) return found;
	}
	return sandboxModeIn(options.system);
}
function sandboxModeIn(value) {
	if (typeof value === "string") return /Current DSH file policy:\s*(read-only|workspace-write|danger-full-access)\./u.exec(value)?.[1];
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = sandboxModeIn(item);
			if (found !== void 0) return found;
		}
		return;
	}
	if (!isRecord$3(value)) return void 0;
	return sandboxModeIn(value.text) ?? sandboxModeIn(value.content);
}
function isRecord$3(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** The Grok chat adapter backed by pi-ai OpenAI Responses. */
var GrokAdapter = class extends LlmAdapter {
	config;
	auth = createGrokPiAiAuth();
	snapshot;
	constructor(config) {
		super();
		this.config = config;
	}
	/** Rebuild the delegated adapter only when the plugin publishes a new options snapshot. */
	current() {
		const options = this.config.options();
		if (this.snapshot?.options === options) return this.snapshot.adapter;
		const profile = createGrokPiAiProfile(options);
		const profiles = /* @__PURE__ */ new Map([[GROK_PROVIDER, profile]]);
		const adapterOptions = {
			profiles: () => profiles,
			resolveApiKey: () => this.config.resolveApiKey(),
			auth: this.auth,
			...this.config.resolveAttachments === void 0 ? {} : { resolveAttachments: this.config.resolveAttachments }
		};
		const adapter = new PiAiAdapter(adapterOptions);
		this.snapshot = {
			options,
			adapter
		};
		return adapter;
	}
	providerInfo(provider) {
		return this.current().providerInfo(provider);
	}
	providerRetryPolicy(provider) {
		return this.current().providerRetryPolicy(provider);
	}
	async listModels(provider) {
		this.snapshot = void 0;
		return this.current().listModels(provider);
	}
	async resolveModel(provider, model, signal) {
		return applyOfficialReasoningMetadata(await this.current().resolveModel(provider, model, signal), this.config.options().models.find((entry) => entry.id === model));
	}
	async *stream(options) {
		for await (const chunk of this.current().stream(narrowGrokEscalationSchemas(options))) yield classifyGrokTransientError(chunk);
	}
	/** Prepare one request with Grok's stream transforms applied. */
	async prepareCall(provider, model, signal) {
		const inner = await this.current().prepareCall(provider, model, signal);
		return {
			model: inner.model,
			stream: async function* (options) {
				for await (const chunk of inner.stream(narrowGrokEscalationSchemas(options))) yield classifyGrokTransientError(chunk);
			}
		};
	}
	/**
	* Declare no provider-specific image pricing so the Host uses neutral estimation.
	* @param _provider - provider route.
	* @param _model - model id.
	* @returns `undefined` because Grok has no image token pricing contract.
	*/
	imageRequestPricing(_provider, _model) {}
};
//#endregion
//#region lib/types/image-bytes.js
/** Magic-byte sniffing for generated Grok images. */
/** Detect PNG, JPEG, WebP, or GIF from a leading signature. */
function mediaTypeOf(data) {
	if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71 && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10) return "image/png";
	if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
	if (data.length >= 6) {
		const signature = String.fromCharCode(...data.subarray(0, 6));
		if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	}
	if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
}
/** File extension that matches a sniffed raster type. */
function extensionOf(mediaType) {
	if (mediaType === "image/jpeg") return "jpg";
	if (mediaType === "image/webp") return "webp";
	if (mediaType === "image/gif") return "gif";
	return "png";
}
//#endregion
//#region lib/types/image-gen-client.js
/**
* Isolated Imagine REST client. Uses the Grok subscription access token
* against api.x.ai, matching Grok Build's ImageGenClient — not cli-chat-proxy.
*/
/** Official Imagine REST base, including `/v1`. */
const GROK_IMAGINE_BASE_URL = "https://api.x.ai/v1";
/** Default Imagine model used by Grok Build quality generations. */
const GROK_IMAGINE_MODEL = "grok-imagine-image-quality";
/** Aspect ratios the Grok Build `image_gen` skill documents. */
const GROK_IMAGINE_ASPECT_RATIOS = [
	"1:1",
	"16:9",
	"9:16",
	"4:3",
	"3:4",
	"3:2",
	"2:3",
	"2:1",
	"1:2",
	"19.5:9",
	"9:19.5",
	"20:9",
	"9:20",
	"auto"
];
/** Default idle bound for one Imagine POST. First-party chat idle is five minutes; Imagine 1K bodies are slower than chat tokens. */
const GROK_IMAGE_GEN_TIMEOUT_MS = 3e5;
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function redact(message, secret) {
	return secret.length === 0 ? message : message.split(secret).join("[redacted]");
}
function fail(message, secret) {
	throw new Error(redact(message, secret));
}
function errorMessage(error) {
	return error instanceof Error && error.message.length > 0 ? error.message : "network error";
}
function isTransportDrop(error) {
	return /\bterminated\b|premature close|ECONNRESET|ECONNABORTED|other side closed|fetch failed/i.test(errorMessage(error));
}
function describeNetworkFailure(error, user, timeout, timeoutMs) {
	if (user?.aborted) return "Grok Imagine request was cancelled";
	if (timeout.aborted) return "Grok Imagine timed out after " + String(timeoutMs / 1e3) + "s";
	if (isTransportDrop(error)) return "Grok Imagine connection dropped while reading the image (undici: terminated)";
	return "Grok Imagine request failed: " + errorMessage(error);
}
function combineSignals(user, timeoutMs) {
	const timeout = AbortSignal.timeout(timeoutMs);
	if (user === void 0) return {
		signal: timeout,
		timeout,
		dispose: () => void 0
	};
	if (typeof AbortSignal.any === "function") return {
		signal: AbortSignal.any([user, timeout]),
		timeout,
		dispose: () => void 0
	};
	const controller = new AbortController();
	const onAbort = () => {
		controller.abort(user.aborted ? user.reason : timeout.reason);
	};
	user.addEventListener("abort", onAbort);
	timeout.addEventListener("abort", onAbort);
	if (user.aborted || timeout.aborted) onAbort();
	return {
		signal: controller.signal,
		timeout,
		dispose: () => {
			user.removeEventListener("abort", onAbort);
			timeout.removeEventListener("abort", onAbort);
		}
	};
}
function requestHeaders(accessToken) {
	return {
		...GROK_CLI_REQUEST_HEADERS,
		"X-Dsh-Plugin": GROK_PLUGIN_IDENTITY_HEADER,
		authorization: "Bearer " + accessToken,
		"content-type": "application/json"
	};
}
function imagesURL(override) {
	if (override !== void 0 && override.length > 0) return override;
	return "https://api.x.ai/v1/images/generations";
}
function decodeB64(value, secret) {
	try {
		return Uint8Array.from(Buffer.from(value, "base64"));
	} catch (error) {
		fail("Grok Imagine returned unreadable image data: " + (error instanceof Error && error.message.length > 0 ? error.message : "invalid base64"), secret);
	}
}
async function downloadUrl(url, accessToken, fetchImpl, signal) {
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: { authorization: "Bearer " + accessToken },
			signal
		});
	} catch (error) {
		fail("Grok Imagine image download failed: " + (error instanceof Error && error.message.length > 0 ? error.message : "network error"), accessToken);
	}
	if (!response.ok) fail("Grok Imagine image download failed with HTTP " + String(response.status), accessToken);
	return new Uint8Array(await response.arrayBuffer());
}
function firstImage(payload, secret) {
	if (!isRecord$2(payload)) fail("Grok Imagine returned an unparseable body", secret);
	const data = payload["data"];
	if (!Array.isArray(data) || data.length === 0 || !isRecord$2(data[0])) fail("Grok Imagine returned no image data", secret);
	const row = data[0];
	const b64 = typeof row["b64_json"] === "string" && row["b64_json"].length > 0 ? row["b64_json"] : void 0;
	const url = typeof row["url"] === "string" && row["url"].length > 0 ? row["url"] : void 0;
	const revisedPrompt = typeof row["revised_prompt"] === "string" && row["revised_prompt"].length > 0 ? row["revised_prompt"] : void 0;
	return {
		...b64 === void 0 ? {} : { b64 },
		...url === void 0 ? {} : { url },
		...revisedPrompt === void 0 ? {} : { revisedPrompt }
	};
}
/**
* POST Imagine `/images/generations` with a Grok session token and return raster bytes.
* @param request - prompt, auth, and optional test overrides.
*/
async function generateGrokImage(request) {
	const prompt = request.prompt.trim();
	if (prompt.length === 0) throw new Error("grok_image_gen prompt must not be empty");
	if (request.aspectRatio !== void 0 && !GROK_IMAGINE_ASPECT_RATIOS.includes(request.aspectRatio)) throw new Error("grok_image_gen aspect_ratio must be one of " + GROK_IMAGINE_ASPECT_RATIOS.join(", "));
	const timeoutMs = request.timeoutMs ?? 3e5;
	const fetchImpl = request.fetchImpl ?? fetch;
	const body = {
		model: GROK_IMAGINE_MODEL,
		prompt,
		n: 1,
		response_format: "b64_json",
		...request.aspectRatio === void 0 ? {} : { aspect_ratio: request.aspectRatio }
	};
	const attempts = 2;
	let raw = "";
	let response;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const { signal, timeout, dispose } = combineSignals(request.signal, timeoutMs);
		try {
			response = await fetchImpl(imagesURL(request.imagesURL), {
				method: "POST",
				headers: requestHeaders(request.accessToken),
				body: JSON.stringify(body),
				signal
			});
			raw = await response.text();
			dispose();
			break;
		} catch (error) {
			dispose();
			if (!(attempt < attempts && !request.signal?.aborted && !timeout.aborted && isTransportDrop(error))) fail(describeNetworkFailure(error, request.signal, timeout, timeoutMs), request.accessToken);
		}
	}
	if (response === void 0) fail("Grok Imagine request failed: network error", request.accessToken);
	if (!response.ok) {
		let detail = raw.slice(0, 500);
		try {
			const parsed = JSON.parse(raw);
			if (isRecord$2(parsed) && isRecord$2(parsed["error"]) && typeof parsed["error"]["message"] === "string") detail = parsed["error"]["message"];
		} catch {}
		fail("Grok Imagine failed with HTTP " + String(response.status) + ": " + detail, request.accessToken);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		fail("Grok Imagine returned an unparseable body", request.accessToken);
	}
	const image = firstImage(parsed, request.accessToken);
	const bytes = image.b64 !== void 0 ? decodeB64(image.b64, request.accessToken) : image.url === void 0 ? fail("Grok Imagine returned no image data", request.accessToken) : await downloadUrl(image.url, request.accessToken, fetchImpl, request.signal ?? AbortSignal.timeout(timeoutMs));
	const mediaType = mediaTypeOf(bytes);
	if (mediaType === void 0) fail("Grok Imagine returned image data that is not PNG, JPEG, WebP, or GIF", request.accessToken);
	return {
		bytes,
		mediaType,
		...image.revisedPrompt === void 0 ? {} : { revisedPrompt: image.revisedPrompt }
	};
}
//#endregion
//#region lib/types/image-gen.js
/** Model-invoked `grok_image_gen` tool over the Grok subscription session. */
/** Public DSH tool name. Distinct from Codex `codex_generate_image`. */
const GROK_IMAGE_GEN_TOOL_NAME = "grok_image_gen";
function refOf(image) {
	return {
		attachmentId: AttachmentId(image.attachmentId),
		mediaType: image.mediaType,
		bytes: image.bytes,
		width: image.width,
		height: image.height,
		...image.name === void 0 ? {} : { name: image.name }
	};
}
function contentOf(value) {
	const lines = [
		"<path>" + value.path + "</path>",
		"<model>" + value.model + "</model>",
		"<image>" + value.image.mediaType + ", " + String(value.image.width) + "x" + String(value.image.height) + " px, " + String(value.image.bytes) + " bytes</image>"
	];
	if (value.revisedPrompt !== void 0) lines.push("<revised_prompt>" + value.revisedPrompt + "</revised_prompt>");
	if (value.saveWarning !== void 0) lines.push("<warning>" + value.saveWarning + "</warning>");
	return [{
		type: "text",
		text: lines.join("\n")
	}, {
		type: "image",
		attachment: refOf(value.image)
	}];
}
function sanitizeFilePart(value) {
	const cleaned = value.replace(/[^a-zA-Z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "");
	return cleaned.length > 0 ? cleaned.slice(0, 48) : "image";
}
function defaultRelativePath(prompt, mediaType) {
	return "generated/grok-" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/gu, "-").replace(/T/u, "-").replace(/Z$/u, "") + "-" + sanitizeFilePart(prompt) + "." + extensionOf(mediaType);
}
function pathForMediaType(path, mediaType) {
	const current = extname(path);
	const currentExtension = current.slice(1).toLowerCase();
	const expectedExtension = extensionOf(mediaType);
	if (currentExtension === expectedExtension || mediaType === "image/jpeg" && currentExtension === "jpeg") return path;
	return (current === "" ? path : path.slice(0, -current.length)) + "." + expectedExtension;
}
async function writeGeneratedFile(ctx, exec, relativePath, bytes) {
	const cwd = exec.agent?.session.header.cwd;
	const target = await ctx.fs.resolve(relativePath, {
		...cwd === void 0 ? {} : { cwd },
		signal: exec.signal
	});
	const processPath = ctx.fs.processPath(target);
	await mkdir(dirname(processPath), { recursive: true });
	await writeFile(processPath, bytes);
	const info = await ctx.fs.stat(target, exec.signal);
	if (info !== void 0) ctx.emit("fs/observed", target, {
		kind: "present",
		version: info.version
	}, exec);
	return target.displayPath;
}
function aspectRatioOf(value) {
	if (value === void 0) return void 0;
	const trimmed = value.trim();
	if (trimmed.length === 0) return void 0;
	if (!GROK_IMAGINE_ASPECT_RATIOS.includes(trimmed)) throw new Error("grok_image_gen aspect_ratio must be one of " + GROK_IMAGINE_ASPECT_RATIOS.join(", "));
	return trimmed;
}
/** Register-ready `grok_image_gen` definition. */
function grokImageGenTool(ctx, options) {
	return defineTool({
		name: GROK_IMAGE_GEN_TOOL_NAME,
		description: "Generate a raster image with Grok Imagine (xAI SuperGrok / Grok Build session). Uses this plugin's xAI login and subscription credits. Distinct from Codex `codex_generate_image`. Do not call unless the user asked for a bitmap image.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "Image prompt. Be specific about subject, composition, style, text, and constraints."
			},
			aspect_ratio: {
				type: "string",
				enum: [...GROK_IMAGINE_ASPECT_RATIOS],
				description: "Optional aspect ratio. Examples: 1:1, 16:9, 9:16, auto."
			},
			path: {
				type: "string",
				description: "Workspace-relative destination. Defaults to generated/grok-<stamp>.<ext> under the session cwd."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					prompt: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					revisedPrompt: { type: "string" },
					saveWarning: { type: "string" },
					image: {
						type: "object",
						required: true,
						additionalProperties: false,
						properties: {
							attachmentId: {
								type: "string",
								required: true
							},
							mediaType: {
								type: "string",
								required: true,
								enum: [
									"image/png",
									"image/jpeg",
									"image/webp",
									"image/gif"
								]
							},
							bytes: {
								type: "integer",
								required: true
							},
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							},
							name: { type: "string" }
						}
					}
				}
			},
			render: (_args, value) => contentOf(value)
		},
		timeoutMs: GROK_IMAGE_GEN_TIMEOUT_MS,
		isConcurrencySafe: () => false,
		async execute(args, exec) {
			const prompt = args.prompt.trim();
			if (prompt.length === 0) throw new Error("grok_image_gen prompt must not be empty");
			const attachments = ctx.attachments;
			const accessToken = await options.resolveAccessToken();
			const aspectRatio = aspectRatioOf(args.aspect_ratio);
			const generated = await generateGrokImage({
				accessToken,
				prompt,
				signal: exec.signal,
				...aspectRatio === void 0 ? {} : { aspectRatio },
				...options.imagesURL === void 0 ? {} : { imagesURL: options.imagesURL },
				...options.fetchImpl === void 0 ? {} : { fetchImpl: options.fetchImpl }
			}).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (/^terminated$/i.test(message)) throw new Error("Grok Imagine connection dropped while reading the image (undici: terminated)");
				throw error;
			});
			if (!attachments.imageLimits.mediaTypes.includes(generated.mediaType)) throw new Error(generated.mediaType + " images are disabled by this deployment");
			const relativePath = args.path === void 0 || args.path.trim().length === 0 ? defaultRelativePath(prompt, generated.mediaType) : pathForMediaType(args.path.trim(), generated.mediaType);
			const ref = await attachments.saveImage({
				data: generated.bytes,
				mediaType: generated.mediaType,
				name: basename(relativePath)
			});
			let path = relativePath;
			let saveWarning;
			try {
				path = await writeGeneratedFile(ctx, exec, relativePath, generated.bytes);
			} catch (error) {
				saveWarning = "Image generation succeeded, but the image could not be saved to disk: " + (error instanceof Error && error.message.length > 0 ? error.message : String(error));
			}
			const value = {
				path,
				prompt,
				model: GROK_IMAGINE_MODEL,
				image: {
					attachmentId: ref.attachmentId,
					mediaType: ref.mediaType,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height,
					...ref.name === void 0 ? {} : { name: ref.name }
				},
				...generated.revisedPrompt === void 0 ? {} : { revisedPrompt: generated.revisedPrompt },
				...saveWarning === void 0 ? {} : { saveWarning }
			};
			if (exec.parent !== void 0) exec.deferContext(createUserMessage({
				content: contentOf(value),
				source: {
					kind: "plugin",
					plugin: "dsh-llm-grok"
				}
			}));
			return value;
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Grok image: " + args.prompt,
			kind: "other",
			rawInput: args.prompt,
			...args.path === void 0 || args.path.trim().length === 0 ? {} : { locations: [{ path: args.path }] }
		})
	});
}
//#endregion
//#region lib/types/model-switch-adapter.js
function generatedValue(value) {
	if (typeof value !== "object" || value === null) throw new Error("Grok image adapter returned no metadata");
	const result = value;
	if (typeof result.path !== "string" || typeof result.image !== "object" || result.image === null) throw new Error("Grok image adapter returned invalid metadata");
	const image = result.image;
	if (typeof image.attachmentId !== "string" || typeof image.mediaType !== "string" || typeof image.bytes !== "number" || typeof image.width !== "number" || typeof image.height !== "number") throw new Error("Grok image adapter returned invalid image metadata");
	return result;
}
function normalize(value) {
	return {
		path: value.path,
		mediaType: value.image.mediaType,
		width: value.image.width,
		height: value.image.height,
		bytes: value.image.bytes,
		attachmentId: value.image.attachmentId,
		...value.image.name === void 0 ? {} : { name: value.image.name },
		...value.revisedPrompt === void 0 ? {} : { revisedPrompt: value.revisedPrompt }
	};
}
/** Optional Image-only integration using the installed Model Switch registry contract. */
function installGrokModelSwitchAdapters(ctx, runtime) {
	let imageContext;
	ctx.inject(["attachments", "fs"], (scope) => {
		imageContext = scope;
		return () => {
			if (imageContext === scope) imageContext = void 0;
		};
	});
	const adapters = {
		provider: "grok",
		image: {
			provider: "grok",
			supportsModel: (model) => imageContext !== void 0 && model === "grok-imagine-image-quality",
			async generate(_model, request, execution) {
				if (typeof execution !== "object" || execution === null) throw new Error("image adapter requires public ToolRunContext");
				if (imageContext === void 0) throw new Error("Grok image adapter requires attachments and fs");
				const tool = grokImageGenTool(imageContext, { resolveAccessToken: () => resolveGrokAccessToken(runtime) });
				const args = {
					prompt: request.prompt,
					...request.path === void 0 ? {} : { path: request.path },
					...request.aspectRatio === void 0 ? {} : { aspect_ratio: request.aspectRatio }
				};
				return normalize(generatedValue(await tool.execute(args, execution)));
			}
		}
	};
	ctx.inject(["modelSwitch"], (scope) => {
		const owner = scope.get("modelSwitch");
		if (owner === void 0) return;
		scope.effect(() => owner.adapters.register(adapters), "Model Switch: register Grok Image adapter");
	});
}
//#endregion
//#region lib/types/discovery.js
/**
* Account model catalog from cli-chat-proxy GET /v1/models-v2.
*/
/** Production models URL. */
const GROK_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models-v2";
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asEffort(value) {
	if (!isRecord$1(value)) return void 0;
	const id = value["id"];
	const wire = value["value"];
	const label = value["label"];
	const description = value["description"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (typeof wire !== "string" || wire.length === 0) return void 0;
	return {
		id,
		value: wire,
		...typeof label === "string" && label.length > 0 ? { label } : {},
		...typeof description === "string" && description.length > 0 ? { description } : {}
	};
}
function asEfforts(value) {
	if (!Array.isArray(value)) return void 0;
	const efforts = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of value) {
		const effort = asEffort(entry);
		if (effort === void 0 || seen.has(effort.value)) continue;
		seen.add(effort.value);
		efforts.push(effort);
	}
	return efforts.length > 0 ? efforts : void 0;
}
function asModel(value) {
	if (!isRecord$1(value)) return void 0;
	const id = value["id"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	const name = value["name"];
	const thinking = value["supports_reasoning_effort"] === true || value["thinking"] === true;
	const defaultReasoningEffort = value["reasoning_effort"];
	const reasoningEfforts = asEfforts(value["reasoning_efforts"]);
	const contextWindow = value["context_window"] ?? value["contextWindow"];
	return {
		id,
		...typeof name === "string" && name.length > 0 ? { name } : {},
		thinking,
		vision: true,
		...typeof contextWindow === "number" && Number.isInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {},
		...thinking && typeof defaultReasoningEffort === "string" && defaultReasoningEffort.length > 0 ? { defaultReasoningEffort } : {},
		...thinking && reasoningEfforts !== void 0 ? { reasoningEfforts } : {}
	};
}
/**
* Parse a models-v2 (or /v1/models) list body.
* @param value - JSON body.
*/
function parseGrokModels(value) {
	if (!isRecord$1(value) || !Array.isArray(value["data"])) return void 0;
	const models = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of value["data"]) {
		const model = asModel(entry);
		if (model === void 0 || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models.length > 0 ? models : void 0;
}
/**
* Read the signed-in account catalog. Failures return undefined so callers
* can keep the last good / frozen list.
*/
async function readGrokModels(request) {
	const url = request.modelsURL ?? "https://cli-chat-proxy.grok.com/v1/models-v2";
	const fetchImpl = request.fetch ?? fetch;
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${request.accessToken}`,
				...GROK_CLI_REQUEST_HEADERS
			},
			redirect: "error",
			...request.signal === void 0 ? {} : { signal: request.signal }
		});
		if (!response.ok) {
			await response.body?.cancel();
			return;
		}
		return parseGrokModels(await response.json());
	} catch {
		return;
	}
}
/** Frozen fallback used when discovery has not succeeded. */
function fallbackGrokCatalog() {
	return GROK_CATALOG.map((model) => ({ ...model }));
}
//#endregion
//#region lib/types/usage.js
/**
* Reading the account's Grok subscription quota for the configuration card.
*
* The Host calls `GET …/v1/billing?format=credits` with the stored access
* token. The browser only receives the decoded window view.
*
* A missing or unrecognized billing surface is `unsupported`, not a failure:
* usage is advisory information, never a blocker.
*
* @module dsh-llm-grok/usage
*/
/** SuperGrok quota lives on the credits flavor, not the prepaid 0/0 envelope. */
const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
/** Per-read budget for one billing request. */
const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 15e3;
/** Replies larger than this are refused; a healthy billing reply is a few KiB. */
const MAX_USAGE_BYTES = 1048576;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function redactSecrets(message, secrets) {
	let next = message;
	for (const secret of secrets) {
		if (secret.length === 0) continue;
		next = next.split(secret).join("[redacted]");
	}
	return next;
}
/** Normalize a billing instant to ISO-8601. Unix seconds and milliseconds are accepted. */
function isoInstant(value) {
	if (typeof value === "string" && value.length > 0) {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? new Date(parsed).toISOString() : void 0;
	}
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		const ms = value < 0xe8d4a51000 ? value * 1e3 : value;
		const date = new Date(ms);
		return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
	}
}
function parseWindow(value) {
	if (!isRecord(value)) return void 0;
	const id = value["id"];
	const used = value["used"];
	const limit = value["limit"];
	const period = value["period"];
	const resetsAt = isoInstant(value["resetsAt"] ?? value["resetAt"] ?? value["reset_at"] ?? value["end"]);
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return void 0;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) return void 0;
	if (period !== void 0 && (typeof period !== "string" || period.length === 0)) return void 0;
	return {
		id,
		used,
		limit,
		...period === void 0 ? {} : { period },
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/** cli-chat-proxy wraps money-like amounts as `{ val: number }`. */
function moneyVal(value) {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (!isRecord(value)) return void 0;
	const val = value["val"];
	if (typeof val !== "number" || !Number.isFinite(val) || val < 0) return void 0;
	return val;
}
function periodFromConfig(config) {
	const type = (isRecord(config["currentPeriod"]) ? config["currentPeriod"] : void 0)?.["type"];
	if (type === "USAGE_PERIOD_TYPE_WEEKLY") return "week";
	if (type === "USAGE_PERIOD_TYPE_MONTHLY") return "month";
}
/** Official grok.com "重置时间" is the current period's end. */
function resetFromConfig(config) {
	return isoInstant((isRecord(config["currentPeriod"]) ? config["currentPeriod"] : void 0)?.["end"] ?? config["billingPeriodEnd"]);
}
function percentWindow(id, percent, period, resetsAt) {
	return {
		id,
		used: Math.min(100, Math.max(0, Math.round(percent * 10) / 10)),
		limit: 100,
		unit: "percent",
		...period === void 0 ? {} : { period },
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
/** Credits flavor: weekly window + per-product usagePercent (0–1). */
function parseCreditsConfig(config, fetchedAt) {
	const period = periodFromConfig(config);
	const resetsAt = resetFromConfig(config);
	const windows = [];
	const products = config["productUsage"];
	if (Array.isArray(products)) for (const entry of products) {
		if (!isRecord(entry)) continue;
		const product = entry["product"];
		const percent = entry["usagePercent"];
		if (typeof product !== "string" || product.length === 0) continue;
		if (typeof percent !== "number" || !Number.isFinite(percent)) continue;
		windows.push(percentWindow(product, percent, period, resetsAt));
	}
	if (windows.length === 0) {
		const percent = config["creditUsagePercent"];
		if (typeof percent === "number" && Number.isFinite(percent)) windows.push(percentWindow("weekly", percent, period, resetsAt));
	}
	return windows.length === 0 ? void 0 : {
		fetchedAt,
		windows
	};
}
/** Prepaid envelope: `{ config: { monthlyLimit, used } }` — SuperGrok is usually 0/0 here. */
function parsePrepaidConfig(config, fetchedAt) {
	const used = moneyVal(config["used"]);
	const limit = moneyVal(config["monthlyLimit"]);
	if (used === void 0 || limit === void 0) return void 0;
	if (used === 0 && limit === 0) return void 0;
	const period = periodFromConfig(config);
	const resetsAt = resetFromConfig(config);
	return {
		fetchedAt,
		windows: [{
			id: "monthly",
			used,
			limit,
			...period === void 0 ? {} : { period },
			...resetsAt === void 0 ? {} : { resetsAt }
		}]
	};
}
function parseCliBillingConfig(value, fetchedAt) {
	if (!isRecord(value)) return void 0;
	const config = value["config"];
	if (!isRecord(config)) return void 0;
	return parseCreditsConfig(config, fetchedAt) ?? parsePrepaidConfig(config, fetchedAt);
}
/**
* Convert the proxy billing JSON into the secret-free snapshot the card renders.
* Unknown bodies and windows that cannot be read return undefined (unsupported).
* @param value - opaque JSON returned by the billing endpoint.
* @param fetchedAt - ISO-8601 instant the Host read the body.
*/
function parseGrokBilling(value, fetchedAt) {
	const fromConfig = parseCliBillingConfig(value, fetchedAt);
	if (fromConfig !== void 0) return fromConfig;
	const windowsValue = isRecord(value) ? value.windows : void 0;
	if (!Array.isArray(windowsValue)) return void 0;
	const windows = [];
	for (const entry of windowsValue) {
		const window = parseWindow(entry);
		if (window !== void 0) windows.push(window);
	}
	if (windows.length === 0) return void 0;
	return {
		fetchedAt,
		windows
	};
}
/**
* Read the account's current billing windows with a Host-held access token.
* 404 and unrecognized JSON are `unsupported`. Transport failures throw a
* message that never includes the token.
* @param request - access token and optional test overrides.
*/
async function readGrokUsage(request) {
	const url = request.billingURL ?? "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
	const fetchImpl = request.fetch ?? fetch;
	const fetchedAt = new Date((request.now ?? Date.now)()).toISOString();
	const timeout = AbortSignal.timeout(DEFAULT_USAGE_REQUEST_TIMEOUT_MS);
	const signal = request.signal === void 0 ? timeout : AbortSignal.any([request.signal, timeout]);
	const secrets = [request.accessToken];
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${request.accessToken}`,
				...GROK_CLI_REQUEST_HEADERS
			},
			redirect: "error",
			signal
		});
	} catch (error) {
		if (request.signal?.aborted === true) throw new Error(redactSecrets("Grok usage read aborted by caller", secrets));
		const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "";
		throw new Error(redactSecrets(`could not reach ${url}${detail}`, secrets));
	}
	if (response.status === 404) {
		await response.body?.cancel();
		return { status: "unsupported" };
	}
	if (response.status === 403) {
		await response.body?.cancel();
		throw new Error("This session cannot read Grok CLI billing. Sign out and sign in again.");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(redactSecrets(`${url} answered ${String(response.status)}`, secrets));
	}
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_USAGE_BYTES) {
		await response.body?.cancel();
		throw new Error(redactSecrets(`${url} answered with more than ${String(MAX_USAGE_BYTES)} bytes`, secrets));
	}
	let text;
	try {
		text = await response.text();
	} catch (error) {
		const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "";
		throw new Error(redactSecrets(`${url} could not be read${detail}`, secrets));
	}
	if (text.length > MAX_USAGE_BYTES) throw new Error(redactSecrets(`${url} answered with more than ${String(MAX_USAGE_BYTES)} bytes`, secrets));
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		return { status: "unsupported" };
	}
	const usage = parseGrokBilling(body, fetchedAt);
	return usage === void 0 ? { status: "unsupported" } : {
		status: "ok",
		usage
	};
}
//#endregion
//#region lib/types/index.js
/**
* Register the `grok` provider directory entry, the Responses chat adapter,
* the `llm-grok` settings section, and the Host Connection `/grok` auth and usage RPC.
* The route is distinct from the built-in `xai` console-key provider.
* @module dsh-llm-grok
*/
/** Preserve Grok's historical normal retry count across host-line default changes. */
const DEFAULT_MAX_RETRIES = 2;
const name = "llm-grok";
const inject = ["llm"];
const NS = GROK_SETTINGS_NAMESPACE;
/**
* The one explicit resolve step from raw config to validated connection facts.
* Catalog membership and the chat base URL are source constants.
* @param config - raw plugin config or resolved settings snapshot.
*/
function resolveModels(models) {
	const seen = /* @__PURE__ */ new Set();
	return (models ?? GROK_CATALOG).map((model) => {
		if (model.id.length === 0) throw new Error("llm-grok: catalog model ids must be non-empty");
		if (model.name !== void 0 && model.name.length === 0) throw new Error(`llm-grok: catalog model "${model.id}" has an empty name`);
		if (seen.has(model.id)) throw new Error(`llm-grok: duplicate catalog model "${model.id}"`);
		seen.add(model.id);
		return {
			id: model.id,
			...model.name === void 0 ? {} : { name: model.name },
			...model.description === void 0 ? {} : { description: model.description },
			...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
			...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
			...model.thinking === void 0 ? {} : { thinking: model.thinking },
			...model.vision === void 0 ? {} : { vision: model.vision },
			...model.tools === void 0 ? {} : { tools: model.tools },
			...model.defaultReasoningEffort === void 0 ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
			...model.reasoningEfforts === void 0 ? {} : { reasoningEfforts: model.reasoningEfforts }
		};
	});
}
function resolveAdapterOptions(config) {
	const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? 3e5;
	if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`llm-grok: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	return {
		baseURL: GROK_CHAT_BASE_URL,
		models: resolveModels(config.models),
		streamIdleTimeoutMs,
		retryPolicy: resolveRetryPolicy(config.retryPolicy ?? {
			mode: "normal",
			maxRetries: DEFAULT_MAX_RETRIES
		}, "llm-grok: retryPolicy")
	};
}
const catalogModel = z.object({
	id: z.string().required(),
	name: z.string(),
	description: z.string(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1),
	vision: z.boolean(),
	thinking: z.boolean(),
	tools: z.boolean()
});
const Config = z.object({
	streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS),
	models: z.array(catalogModel),
	enableImageGen: z.boolean().default(false),
	retryPolicy: RetryPolicySchema,
	registerLegacyTools: z.boolean().default(true)
});
function internalError(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
function usageFailure(error, secrets) {
	let message = error instanceof Error && error.message.length > 0 ? error.message : "Grok usage read failed";
	for (const secret of secrets) {
		if (secret.length === 0) continue;
		message = message.split(secret).join("[redacted]");
	}
	return internalError(message);
}
/**
* Host Connection `/grok` handler. Status, start, and usage replies never include tokens;
* the Alpha.4 Host Connection service applies browser authentication and trusted-host policy.
* @param runtime - Host OAuth runtime (production or a test fake).
* @param options - optional billing URL override for tests.
*/
function createGrokRpcHandler(runtime, options) {
	return async (endpoint, payload, signal) => {
		if (endpoint === "auth/start") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok auth start request");
			const started = await beginPkceLogin(runtime);
			return {
				ok: true,
				value: "attemptId" in started ? {
					ok: true,
					...started
				} : started
			};
		}
		if (endpoint === "auth/attempt-status") {
			const attemptId = payload?.attemptId;
			if (typeof attemptId !== "string" || attemptId.length === 0) return internalError("invalid Grok auth attempt status request");
			return {
				ok: true,
				value: {
					attemptId,
					state: statusPkceLogin(runtime, attemptId)
				}
			};
		}
		if (endpoint === "auth/status") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok auth status request");
			return {
				ok: true,
				value: statusFromSession(await ensureFreshSession(runtime))
			};
		}
		if (endpoint === "auth/logout") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok auth logout request");
			cancelAllPkceLogins(runtime);
			await deleteSession(runtime.resolveSessionPath());
			return {
				ok: true,
				value: { ok: true }
			};
		}
		if (endpoint === "auth/cancel") {
			const value = payload;
			if (typeof value?.attemptId !== "string" || value.attemptId.length === 0) return internalError("invalid Grok auth cancel request");
			if (!cancelPkceLogin(runtime, value.attemptId)) return internalError("stale Grok sign-in attempt");
			return {
				ok: true,
				value: { ok: true }
			};
		}
		if (endpoint === "auth/complete") {
			const request = decodeGrokAuthCompleteRequest(payload);
			if (request === void 0) return internalError("invalid Grok auth complete request");
			if (request.attemptId !== void 0) return {
				ok: true,
				value: await completePkceLogin(runtime, request.attemptId, request.code)
			};
			return {
				ok: true,
				value: await completePkceLogin(runtime, request.code)
			};
		}
		if (endpoint === "models/list") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok models request");
			const session = await ensureFreshSession(runtime);
			if (session === void 0) return {
				ok: true,
				value: { models: fallbackGrokCatalog() }
			};
			return {
				ok: true,
				value: { models: await readGrokModels({
					accessToken: session.accessToken,
					...options?.modelsURL === void 0 ? {} : { modelsURL: options.modelsURL },
					fetch: runtime.fetch,
					signal
				}) ?? fallbackGrokCatalog() }
			};
		}
		if (endpoint === "usage/read") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok usage request");
			const session = await ensureFreshSession(runtime);
			if (session === void 0) return {
				ok: true,
				value: { status: "logged-out" }
			};
			try {
				return {
					ok: true,
					value: await readGrokUsage({
						accessToken: session.accessToken,
						...options?.billingURL === void 0 ? {} : { billingURL: options.billingURL },
						fetch: runtime.fetch,
						now: runtime.now,
						signal
					})
				};
			} catch (error) {
				return usageFailure(error, [session.accessToken, session.refreshToken]);
			}
		}
		return internalError(`unknown Grok endpoint: ${endpoint}`);
	};
}
/** Return the schema-decoded, secret-free settings snapshot and descriptor revision. */
async function readDisplayedSettings(ctx, payload) {
	if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok settings read request");
	const descriptor = ctx.get("settings")?.describe().find((entry) => entry.ns === NS);
	if (descriptor === void 0) return internalError("Grok settings are unavailable");
	const settings = decodeGrokSettings(descriptor.value);
	if (settings === void 0) return internalError("Grok settings are invalid");
	return {
		ok: true,
		value: {
			settings,
			revision: descriptor.revision
		}
	};
}
async function saveDisplayedCatalog(ctx, payload) {
	const request = decodeGrokSaveRequest(payload);
	if (request === void 0) return internalError("invalid Grok settings request");
	const settings = ctx.get("settings");
	if (settings === void 0) return internalError("Grok settings are unavailable");
	try {
		const before = settings.describe().find((descriptor) => descriptor.ns === NS);
		if (before === void 0) return internalError("Grok settings are unavailable");
		const current = decodeGrokSettings(before.value);
		if (current === void 0) return internalError("Grok settings are invalid");
		const ops = [];
		if (!deepEqualJson(current.models, request.models)) ops.push({
			op: "set",
			path: ["models"],
			value: request.models
		});
		if (request.enableImageGen !== void 0 && current.enableImageGen !== request.enableImageGen) ops.push({
			op: "set",
			path: ["enableImageGen"],
			value: request.enableImageGen
		});
		if (ops.length > 0) await settings.mutate(NS, ops, request.expectedRevision);
		const accepted = settings.describe().find((descriptor) => descriptor.ns === NS);
		const acceptedSettings = decodeGrokSettings(accepted?.value);
		if (accepted === void 0 || acceptedSettings === void 0) return internalError("Grok settings could not be reloaded");
		return {
			ok: true,
			value: {
				settings: acceptedSettings,
				revision: accepted.revision
			}
		};
	} catch (error) {
		return internalError(error instanceof Error && error.message.length > 0 ? error.message : "Grok settings save failed");
	}
}
function apply(ctx, config) {
	if (!allowDshRuntime(ctx.logger, "dsh-llm-grok", ["@deepseek-ai/dsh-llm"])) return;
	let current = () => config;
	let lastRaw;
	let lastGood;
	const options = () => {
		const raw = current();
		if (raw === lastRaw && lastGood !== void 0) return lastGood;
		try {
			const next = resolveAdapterOptions(raw);
			lastRaw = raw;
			lastGood = next;
			return next;
		} catch (error) {
			if (lastGood === void 0) throw error;
			lastRaw = raw;
			ctx.logger.error("llm-grok: keeping the last good configuration after an invalid settings section");
			ctx.logger.error(error);
			return lastGood;
		}
	};
	options();
	const runtime = createGrokAuthRuntime({ resolveSessionPath: () => resolveGrokSessionPath(ctx) });
	ctx.effect(() => () => {
		cancelAllPkceLogins(runtime);
	}, "llm-grok: cancel OAuth attempts");
	installGrokModelSwitchAdapters(ctx, runtime);
	const adapter = new GrokAdapter({
		options,
		resolveApiKey: () => resolveGrokAccessToken(runtime),
		resolveAttachments: () => ctx.get("attachments")
	});
	ctx.llm.registerConfigurableProviders([{
		provider: GROK_PROVIDER,
		displayName: "Grok",
		settingsNs: NS,
		settingsPath: []
	}]);
	const registration = ctx.llm.registerAdapter([GROK_PROVIDER], adapter);
	let registeredPolicy = options().retryPolicy;
	const ensureRegistrationFacts = () => {
		lastRaw = void 0;
		const policy = options().retryPolicy;
		if (deepEqualJson(policy, registeredPolicy)) return;
		registration.replace([GROK_PROVIDER]);
		registeredPolicy = policy;
	};
	const connectionFiber = ctx.inject(["connection"], (connectionCtx) => {
		const inner = createGrokRpcHandler(runtime);
		connectionCtx.effect(() => connectionCtx.connection.rpc.handle(GROK_RPC_CHANNEL, async (endpoint, payload, signal) => {
			if (endpoint === "settings/read") return readDisplayedSettings(ctx, payload);
			if (endpoint === "settings/save") return saveDisplayedCatalog(ctx, payload);
			return inner(endpoint, payload, signal);
		}), "llm-grok: register Host Connection RPC");
	});
	ctx.effect(() => () => connectionFiber.dispose(), "llm-grok: dispose Host Connection injection");
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, NS, Config, config, {
			setSource: (source) => {
				current = source;
			},
			onChange: scheduleCapabilities
		});
	});
	let stopped = false;
	let imageGenFiber;
	let imageGenTail = Promise.resolve();
	const reconcileImageGen = async () => {
		if (stopped) return;
		const enabled = current().registerLegacyTools !== false && current().enableImageGen === true;
		if (enabled === (imageGenFiber !== void 0)) return;
		const previous = imageGenFiber;
		imageGenFiber = void 0;
		if (previous !== void 0) await previous.dispose();
		if (stopped || !enabled) return;
		const fiber = ctx.inject([
			"tools",
			"fs",
			"attachments"
		], (toolCtx) => toolCtx.tools.register(grokImageGenTool(toolCtx, { resolveAccessToken: () => resolveGrokAccessToken(runtime) })));
		imageGenFiber = fiber;
		Promise.resolve(fiber).catch((error) => {
			if (imageGenFiber === fiber) imageGenFiber = void 0;
			ctx.logger.error("llm-grok: optional grok_image_gen tool failed to activate");
			ctx.logger.error(error);
		});
	};
	function scheduleCapabilities() {
		ensureRegistrationFacts();
		imageGenTail = imageGenTail.then(reconcileImageGen, reconcileImageGen).catch((error) => {
			ctx.logger.error("llm-grok: could not apply the updated grok_image_gen configuration");
			ctx.logger.error(error);
		});
	}
	scheduleCapabilities();
	ctx.effect(() => async () => {
		stopped = true;
		await imageGenTail;
		const imageGen = imageGenFiber;
		imageGenFiber = void 0;
		await imageGen?.dispose();
	});
}
//#endregion
export { Config, DEFAULT_USAGE_REQUEST_TIMEOUT_MS, GROK_4_5_REASONING_EFFORTS, GROK_4_6_REASONING_EFFORTS, GROK_AUTH_ATTEMPT_STATUS_ENDPOINT, GROK_AUTH_CANCEL_ENDPOINT, GROK_AUTH_COMPLETE_ENDPOINT, GROK_AUTH_LOGOUT_ENDPOINT, GROK_AUTH_START_ENDPOINT, GROK_AUTH_STATUS_ENDPOINT, GROK_BILLING_URL, GROK_CATALOG, GROK_CHAT_BASE_URL, GROK_DEFAULT_CONTEXT_WINDOW, GROK_DEFAULT_MODEL_MAX_TOKENS, GROK_DEFAULT_REASONING_WIRE, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_IMAGE_GEN_TOOL_NAME, GROK_IMAGINE_ASPECT_RATIOS, GROK_IMAGINE_BASE_URL, GROK_IMAGINE_MODEL, GROK_MODELS_ENDPOINT, GROK_MODELS_URL, GROK_OAUTH_CLIENT_ID, GROK_OAUTH_ISSUER, GROK_OAUTH_SCOPE, GROK_PACKED_REASONING_TYPE, GROK_PLUGIN_IDENTITY_HEADER, GROK_PROVIDER, GROK_REASONING_WIRES, GROK_RPC_CHANNEL, GROK_SAVE_ENDPOINT, GROK_SERVER_SEARCH_TOOLS, GROK_SESSION_FILENAME, GROK_SETTINGS_NAMESPACE, GROK_SETTINGS_READ_ENDPOINT, GROK_USAGE_ENDPOINT, GrokAdapter, apply, applyGrokReasoningWire, beginPkceLogin, cancelAllPkceLogins, cancelPkceLogin, completePkceLogin, createGrokAuthRuntime, createGrokPiAiProfile, createGrokRpcHandler, decodeGrokAuthAttemptStatus, decodeGrokAuthCompleteRequest, decodeGrokAuthLogoutReply, decodeGrokAuthStartReply, decodeGrokAuthStatus, decodeGrokEmptyRequest, decodeGrokModelsReply, decodeGrokSaveRequest, decodeGrokSaveResult, decodeGrokSettings, decodeGrokSettingsReadResult, decodeGrokUsageReply, decodeGrokUsageView, deleteSession, ensureFreshSession, expandPackedGrokReasoningInput, fallbackGrokCatalog, filterGrokThinkingStream, generateGrokImage, grokImageGenTool, grokResponsesApi, grokThinkingLevelMap, inject, injectGrokServerSearchTools, installGrokModelSwitchAdapters, isDisplayableThinking, isGrokPackedReasoning, isGrokServerSearchToolCallId, name, officialDefaultEffort, officialEffortsFor, packGrokThinkingBlocks, parseGrokBilling, parseGrokModels, readGrokModels, readGrokUsage, readSession, refreshSession, resolveAdapterOptions, resolveGrokAccessToken, resolveGrokReasoningWire, resolveGrokSessionPath, sessionPathForHome, startPkceLogin, statusFromSession, stripGrokServerSearchToolCalls, writeSession };
