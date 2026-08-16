/**
 * Reading the account's Grok subscription quota for the configuration card.
 *
 * The Host calls `GET https://cli-chat-proxy.grok.com/v1/billing` with the
 * stored access token. The browser only receives the decoded window view.
 *
 * A missing or unrecognized billing surface is `unsupported`, not a failure:
 * usage is advisory information, never a blocker.
 *
 * @module dsh-llm-grok/usage
 */
import type { GrokUsageView } from './client-contract.ts';
/** Production billing URL used by the Grok CLI chat proxy. */
export declare const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
/** Per-read budget for one billing request. */
export declare const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 15000;
/** One Host billing read: stored access token plus test overrides. */
export interface GrokUsageRequest {
    /** Current session access token. Never forwarded to the browser. */
    accessToken: string;
    /** Override the production billing URL (local fake server). */
    billingURL?: string;
    /** Fetch implementation; production uses global fetch. */
    fetch?: typeof fetch;
    /** Clock used for {@link GrokUsageView.fetchedAt}. */
    now?: () => number;
    /** Caller cancellation. */
    signal?: AbortSignal;
}
/**
 * Convert the proxy billing JSON into the secret-free snapshot the card renders.
 * Unknown bodies and windows that cannot be read return undefined (unsupported).
 * @param value - opaque JSON returned by the billing endpoint.
 * @param fetchedAt - ISO-8601 instant the Host read the body.
 */
export declare function parseGrokBilling(value: unknown, fetchedAt: string): GrokUsageView | undefined;
/**
 * Read the account's current billing windows with a Host-held access token.
 * 404 and unrecognized JSON are `unsupported`. Transport failures throw a
 * message that never includes the token.
 * @param request - access token and optional test overrides.
 */
export declare function readGrokUsage(request: GrokUsageRequest): Promise<{
    status: 'ok';
    usage: GrokUsageView;
} | {
    status: 'unsupported';
}>;
//# sourceMappingURL=usage.d.ts.map