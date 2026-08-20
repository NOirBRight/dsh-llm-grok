/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */
/** Settings namespace owned by the Grok plugin. */
export declare const GROK_SETTINGS_NAMESPACE = "llm-grok";
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
export declare const GROK_PROVIDER = "grok";
/** Default maximum idle interval while a stream read is outstanding. */
export declare const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Private Connection RPC channel used by this package's Host and Web faces. */
export declare const GROK_RPC_CHANNEL = "/grok";
/** Begin a Host-owned PKCE sign-in against auth.x.ai. */
export declare const GROK_AUTH_START_ENDPOINT = "auth/start";
/** Secret-free login snapshot. */
export declare const GROK_AUTH_STATUS_ENDPOINT = "auth/status";
/** Delete the Host session file. */
export declare const GROK_AUTH_LOGOUT_ENDPOINT = "auth/logout";
/** Deliver a Grok Build paste-code into the in-flight PKCE exchange. */
export declare const GROK_AUTH_COMPLETE_ENDPOINT = "auth/complete";
/** Secret-free subscription-usage snapshot inside {@link GROK_RPC_CHANNEL}. */
export declare const GROK_USAGE_ENDPOINT = "usage/read";
/** One official models-v2 reasoning menu row (`id` → wire `value`). */
export interface GrokReasoningEffort {
    /** Menu option id accepted by `/effort` and `--effort`. */
    id: string;
    /** Value written to Responses `reasoning.effort`. */
    value: string;
    /** Official menu label (`Extra High Effort`, …). */
    label?: string;
    /** Official menu description. */
    description?: string;
}
/** One model in the plugin's frozen catalog. */
export interface GrokCatalogModel {
    /** Wire model id accepted by the chat proxy. */
    id: string;
    /** Selector label; omission uses {@link id}. */
    name?: string;
    /** Optional selector detail. */
    description?: string;
    /** Known combined request and response context capacity. */
    contextWindow?: number;
    /** Per-request output cap for this model. */
    maxTokens?: number;
    /** Whether the model supports native thinking. */
    thinking?: boolean;
    /** Official advertised reasoning menu; omission uses the frozen per-id list. */
    reasoningEfforts?: readonly GrokReasoningEffort[];
    /** Official default `reasoning.effort` (`reasoning_effort` on models-v2). */
    defaultReasoningEffort?: string;
    /** Whether the model accepts image input. */
    vision?: boolean;
    /** Whether the model supports tool calls. */
    tools?: boolean;
}
export declare const GROK_CATALOG: readonly GrokCatalogModel[];
/** Account model list inside {@link GROK_RPC_CHANNEL}. */
export declare const GROK_MODELS_ENDPOINT = "models/list";
/** Atomic settings-save endpoint. */
export declare const GROK_SAVE_ENDPOINT = "settings/save";
/** Settings fields presented by the package's Web configuration card. No apiKeyEnv. */
export interface GrokSettingsView {
    /** Stream idle timeout in milliseconds. */
    streamIdleTimeoutMs: number;
    /** Displayed advisory catalog (a subset of the account catalog). */
    models: GrokCatalogModel[];
    /** When true, register the `grok_image_gen` tool. */
    enableImageGen: boolean;
}
/** Atomic editable-settings payload sent by the browser face. */
export interface GrokSaveRequest {
    /** Complete displayed catalog currently shown by the editor. */
    models: GrokCatalogModel[];
    /** Optional `grok_image_gen` enablement; omission leaves the current value. */
    enableImageGen?: boolean;
    /** Settings descriptor revision from which the editor began. */
    expectedRevision: number;
}
/** Accepted settings snapshot after one Host mutation. */
export interface GrokSaveResult {
    settings: GrokSettingsView;
    revision: number;
}
/** Secret-free login snapshot returned by {@link GROK_AUTH_STATUS_ENDPOINT}. */
export interface GrokAuthStatus {
    /** Whether the Host currently holds a usable session file. */
    loggedIn: boolean;
    /** Account email when the session recorded one. */
    email?: string;
    /** ISO-8601 access-token expiry when the session recorded one. */
    expiresAt?: string;
}
/**
 * Result of {@link GROK_AUTH_START_ENDPOINT}. Cancel, timeout, and state
 * mismatch are retryable failures, not internal errors.
 */
export type GrokAuthStartReply = {
    ok: true;
} | {
    ok: false;
    retryable: true;
    message: string;
};
/** Loopback payload for {@link GROK_AUTH_COMPLETE_ENDPOINT}. */
export interface GrokAuthCompleteRequest {
    /** Short-lived authorization code copied from the IdP page. Not a token. */
    code: string;
}
/** Result of {@link GROK_AUTH_LOGOUT_ENDPOINT}. */
export interface GrokAuthLogoutReply {
    /** Logout always reports success after the session file is gone. */
    ok: true;
}
/** One metered quota window decoded from the Host billing snapshot. */
export interface GrokUsageWindow {
    /** Stable window id shown as the meter label (`monthly`, `weekly`, …). */
    id: string;
    /** Consumed amount in the window. */
    used: number;
    /** Window ceiling. */
    limit: number;
    /** Optional period label from the billing payload (`month`, `week`, …). */
    period?: string;
    /** When `percent`, the card shows used as a 0–100 percentage. */
    unit?: 'percent';
    /** ISO-8601 instant the official dashboard calls 重置时间 / reset time. */
    resetsAt?: string;
}
/** Secret-free usage snapshot the configuration card renders. */
export interface GrokUsageView {
    /** ISO-8601 time the Host read the snapshot. */
    fetchedAt: string;
    /** Decoded windows, provider order, at least one entry. */
    windows: GrokUsageWindow[];
}
/**
 * Usage answer crossing the plugin RPC. Logged-out and unsupported are
 * legitimate answers, not transport failures, so they ride the success
 * branch instead of an error code.
 */
export interface GrokModelsReply {
    /** Models the signed-in account can use, provider order. */
    models: GrokCatalogModel[];
}
export type GrokUsageReply = {
    status: 'ok';
    usage: GrokUsageView;
} | {
    status: 'unsupported';
} | {
    status: 'logged-out';
};
/**
 * Narrow the schema-resolved settings section before it enters React state.
 * @param value - untrusted settings response value.
 * @returns the validated settings view, or undefined when the response is invalid.
 */
export declare function decodeGrokSettings(value: unknown): GrokSettingsView | undefined;
/**
 * Narrow an empty auth RPC payload. Token-shaped fields are rejected so a
 * confused caller cannot push secrets across the loopback channel.
 * @param value - untrusted RPC request payload.
 * @returns an empty object, or undefined when the payload is invalid.
 */
/**
 * Narrow a paste-code completion request. The value is an authorization code,
 * not an access token; token-shaped field names are still rejected.
 * @param value - untrusted RPC request payload.
 */
export declare function decodeGrokAuthCompleteRequest(value: unknown): GrokAuthCompleteRequest | undefined;
export declare function decodeGrokEmptyRequest(value: unknown): Record<string, never> | undefined;
/**
 * Narrow the Host start-login reply before the card updates.
 * @param value - untrusted RPC result value.
 * @returns the validated reply, or undefined when it is malformed or carries secrets.
 */
export declare function decodeGrokAuthStartReply(value: unknown): GrokAuthStartReply | undefined;
/**
 * Narrow the secret-free login snapshot. Token-shaped fields fail closed.
 * @param value - untrusted RPC result value.
 * @returns the validated status, or undefined when it is malformed or carries secrets.
 */
export declare function decodeGrokAuthStatus(value: unknown): GrokAuthStatus | undefined;
/**
 * Narrow the logout reply.
 * @param value - untrusted RPC result value.
 * @returns the validated reply, or undefined when it is malformed or carries secrets.
 */
export declare function decodeGrokAuthLogoutReply(value: unknown): GrokAuthLogoutReply | undefined;
/**
 * Narrow one usage snapshot.
 * @param value - untrusted JSON value.
 * @returns the validated snapshot, or undefined when it is malformed or carries secrets.
 */
export declare function decodeGrokUsageView(value: unknown): GrokUsageView | undefined;
export declare function decodeGrokCatalogModel(value: unknown): GrokCatalogModel | undefined;
export declare function decodeGrokModelsReply(value: unknown): GrokModelsReply | undefined;
/**
 * Narrow an atomic catalog-save request. Token-shaped fields fail closed.
 * @param value - untrusted RPC request payload.
 */
export declare function decodeGrokSaveRequest(value: unknown): GrokSaveRequest | undefined;
/**
 * Narrow the Host save reply before the card updates.
 * @param value - untrusted RPC result value.
 */
export declare function decodeGrokSaveResult(value: unknown): GrokSaveResult | undefined;
export declare function decodeGrokUsageReply(value: unknown): GrokUsageReply | undefined;
//# sourceMappingURL=client-contract.d.ts.map