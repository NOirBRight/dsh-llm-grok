/**
 * Host-owned xAI PKCE (S256) against the Grok CLI public client.
 * Tokens stay on the Host; this module never logs Authorization headers.
 */
import type { GrokAuthStartReply } from './client-contract.ts';
import type { GrokSession } from './session.ts';
/** Issuer used by the Grok CLI public client. */
export declare const GROK_OAUTH_ISSUER = "https://auth.x.ai";
/** Public client_id from the Grok CLI auth.json key `https://auth.x.ai::<client_id>`. */
export declare const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/**
 * Scopes the official Grok CLI requests. `grok-cli:access` is what
 * cli-chat-proxy billing and chat treat as a CLI token; `api:access` alone
 * signs in but is rejected as "must be performed by Grok CLI token users".
 */
export declare const GROK_OAUTH_SCOPE: string;
/** Pinned authorize path when OIDC discovery is unavailable. */
export declare const GROK_OAUTH_AUTHORIZE_PATH = "/oauth2/authorize";
/** Pinned token path when OIDC discovery is unavailable. */
export declare const GROK_OAUTH_TOKEN_PATH = "/oauth2/token";
/** How long the loopback listener waits for the browser callback. */
export declare const GROK_OAUTH_TIMEOUT_MS = 300000;
/** Refresh when the access token expires within this window. */
export declare const GROK_OAUTH_REFRESH_SKEW_MS = 60000;
/** Discovered or pinned OIDC endpoints. */
export interface GrokOidcEndpoints {
    /** Authorization-code endpoint. */
    authorizationEndpoint: string;
    /** Token endpoint (code exchange and refresh). */
    tokenEndpoint: string;
    /** Optional userinfo endpoint used when the id_token has no email. */
    userinfoEndpoint?: string;
}
/** Injectable Host OAuth runtime. */
export interface GrokOAuthRuntime {
    /** Absolute `$DSH_HOME/grok-oauth.json` path. */
    resolveSessionPath: () => string;
    /** OIDC issuer; production is {@link GROK_OAUTH_ISSUER}. */
    issuer: string;
    /** Public OAuth client id. */
    clientId: string;
    /** Space-delimited scope list. */
    scope: string;
    /** Open the system browser to the authorize URL. */
    openBrowser: (url: string) => Promise<void>;
    /** Fetch implementation used for discovery and token posts. */
    fetch: typeof fetch;
    /** Clock used for expiry and refresh skew. */
    now: () => number;
    /** Callback wait budget. */
    timeoutMs: number;
    /** Refresh when remaining lifetime is below this many milliseconds. */
    refreshSkewMs: number;
}
/** PKCE S256 pair plus a CSRF state. */
export declare function createPkcePair(): {
    verifier: string;
    challenge: string;
    state: string;
};
/**
 * Discover authorize/token endpoints, falling back to the Grok CLI paths.
 * @param issuer - OIDC issuer origin.
 * @param fetchImpl - HTTP client.
 */
export declare function discoverOidcEndpoints(issuer: string, fetchImpl?: typeof fetch): Promise<GrokOidcEndpoints>;
/** Open the authorize URL with xdg-open, then sensible-open. */
export declare function openSystemBrowser(url: string): Promise<void>;
/**
 * Fill production defaults for the Host OAuth runtime.
 * @param overrides - required session path plus optional test fakes.
 */
export declare function createGrokAuthRuntime(overrides: Partial<GrokOAuthRuntime> & Pick<GrokOAuthRuntime, 'resolveSessionPath'>): GrokOAuthRuntime;
/**
 * Exchange a refresh token. Callers delete the session when this returns undefined.
 * @param runtime - Host OAuth runtime.
 * @param session - current session.
 */
export declare function refreshSession(runtime: GrokOAuthRuntime, session: GrokSession): Promise<GrokSession | undefined>;
/**
 * Return a session that is not near expiry, refreshing or clearing as needed.
 * @param runtime - Host OAuth runtime.
 */
export declare function ensureFreshSession(runtime: GrokOAuthRuntime): Promise<GrokSession | undefined>;
/**
 * Run one loopback PKCE sign-in. Cancel, timeout, and state mismatch leave
 * the session file untouched.
 * @param runtime - Host OAuth runtime.
 * @param signal - RPC abort signal.
 */
export declare function startPkceLogin(runtime: GrokOAuthRuntime, signal?: AbortSignal): Promise<GrokAuthStartReply>;
/**
 * Deliver a code copied from the Grok Build "paste this code" page into the
 * in-flight PKCE exchange. The Host still owns the verifier; the browser only
 * sends the short-lived authorization code over the authenticated Host Connection RPC.
 * @param runtime - the same runtime `startPkceLogin` is waiting on.
 * @param code - trimmed authorization code from the IdP page.
 */
/** Remote-safe OAuth transaction returned before any opener or callback wait. */
export interface GrokAuthAttempt {
    attemptId: string;
    authorizationUrl: string;
}
export declare function beginPkceLogin(runtime: GrokOAuthRuntime): Promise<GrokAuthAttempt | GrokAuthStartReply>;
export declare function cancelPkceLogin(runtime: GrokOAuthRuntime, attemptId: string): boolean;
export declare function cancelAllPkceLogins(runtime: GrokOAuthRuntime): void;
export declare function statusPkceLogin(runtime: GrokOAuthRuntime, attemptId: string): 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'missing';
export declare function completePkceLogin(runtime: GrokOAuthRuntime, codeOrAttemptId: string, remoteCode?: string): Promise<GrokAuthStartReply>;
//# sourceMappingURL=oauth.d.ts.map