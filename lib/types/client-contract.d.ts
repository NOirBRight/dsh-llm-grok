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
/** Secret-free subscription-usage snapshot inside {@link GROK_RPC_CHANNEL}. */
export declare const GROK_USAGE_ENDPOINT = "usage/read";
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
/**
 * Narrow the usage reply returned by the Host usage endpoint.
 * @param value - untrusted RPC result value.
 * @returns the validated reply, or undefined when it is malformed or carries secrets.
 */
export declare function decodeGrokUsageReply(value: unknown): GrokUsageReply | undefined;
//# sourceMappingURL=client-contract.d.ts.map