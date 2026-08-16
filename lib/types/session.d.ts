/**
 * Host-only Grok OAuth session file. Tokens never leave this module through
 * the RPC contract; the browser only sees {@link statusFromSession}.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { GrokAuthStatus } from './client-contract.ts';
/** File name under `$DSH_HOME`. Never `~/.grok/auth.json`. */
export declare const GROK_SESSION_FILENAME = "grok-oauth.json";
/** Access and refresh material stored only on the Host. */
export interface GrokSession {
    /** Bearer access token for later authenticated Host work. */
    accessToken: string;
    /** Refresh token used when the access token is near expiry. */
    refreshToken: string;
    /** ISO-8601 instant after which the access token should be refreshed. */
    expiresAt: string;
    /** Account email when the IdP supplied one. */
    email?: string;
    /** Account subject / user id when the IdP supplied one. */
    userId?: string;
}
/**
 * Resolve `$DSH_HOME` from the launch-environment snapshot, then `~/.dsh`.
 * @param ctx - Host plugin context that may carry a launcher snapshot.
 * @returns the absolute session file path.
 */
export declare function resolveGrokSessionPath(ctx: Context): string;
/**
 * Build the session path under an already-resolved harness home.
 * @param dshHome - absolute or home-relative harness home.
 */
export declare function sessionPathForHome(dshHome: string): string;
/**
 * Narrow a session document. Rejects missing token or expiry fields.
 * @param value - parsed JSON.
 */
export declare function decodeGrokSession(value: unknown): GrokSession | undefined;
/**
 * Read the session file. Missing or corrupt documents are treated as signed-out.
 * @param path - absolute session path.
 */
export declare function readSession(path: string): Promise<GrokSession | undefined>;
/**
 * Atomically write the session file with mode `0600`.
 * @param path - absolute session path.
 * @param session - tokens and account identity.
 */
export declare function writeSession(path: string, session: GrokSession): Promise<void>;
/**
 * Delete the session file. Missing files are success.
 * @param path - absolute session path.
 */
export declare function deleteSession(path: string): Promise<void>;
/**
 * Project a Host session into the secret-free RPC status view.
 * @param session - current session, if any.
 */
export declare function statusFromSession(session: GrokSession | undefined): GrokAuthStatus;
//# sourceMappingURL=session.d.ts.map