/**
 * Reading the account's Grok subscription quota for the configuration card.
 *
 * The Host calls `GET …/v1/billing?format=credits` with the stored access
 * token. The browser only receives the decoded window view.
 *
 * A missing billing surface (404) is `unsupported`, not a failure.
 * A 200 with an unrecognized body throws: the capability exists but the
 * read failed, so the sidebar shows an error (keeping stale data), never
 * `unsupported` (capability absent). One documented exception: the official
 * GetGrokCreditsConfig shape omits zero-valued proto3 scalars, so a valid,
 * still-open currentPeriod with credit_usage_percent omitted decodes to 0%
 * used. Usage is advisory, never a blocker.
 *
 * @module dsh-llm-grok/usage
 */
import type { GrokUsageView } from './client-contract.ts';
/** SuperGrok quota lives on the credits flavor, not the prepaid 0/0 envelope. */
export declare const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
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
 * Unknown bodies and windows that cannot be read return undefined; the
 * caller throws on undefined (a failed read), never `unsupported`.
 * @param value - opaque JSON returned by the billing endpoint.
 * @param fetchedAt - ISO-8601 instant the Host read the body.
 */
export declare function parseGrokBilling(value: unknown, fetchedAt: string): GrokUsageView | undefined;
/**
 * Read the account's current billing windows with a Host-held access token.
 * Only 404 is `unsupported` (no billing surface). Unrecognized 200 JSON
 * (except the documented zero-omitted credits shape), non-JSON bodies, and
 * transport/rate-limit/auth failures throw a message that never includes
 * the token.
 * @param request - access token and optional test overrides.
 */
export declare function readGrokUsage(request: GrokUsageRequest): Promise<{
    status: 'ok';
    usage: GrokUsageView;
} | {
    status: 'unsupported';
}>;
//# sourceMappingURL=usage.d.ts.map