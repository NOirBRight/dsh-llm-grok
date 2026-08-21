/**
 * In-memory pi-ai auth injection for Grok's request-scoped subscription route.
 *
 * Grok resolves its access token through `resolveApiKey` for each request, so the
 * store starts empty. It remains available for a future login flow without using
 * pi-ai's per-collection default store.
 *
 * @module dsh-llm-grok/pi-ai-auth
 */
import type { AuthContext, CredentialStore } from '@earendil-works/pi-ai';
type PiAiAuthInjection = {
    credentials: CredentialStore;
    authContext: AuthContext;
};
/**
 * Create the auth injectables for a Grok pi-ai collection.
 *
 * The credential store retains records in memory for the lifetime of the
 * returned injection. Ambient provider lookups are deliberately disabled.
 *
 * @returns an in-memory credential store and a finds-nothing auth context.
 */
export declare function createGrokPiAiAuth(): PiAiAuthInjection;
export {};
//# sourceMappingURL=pi-ai-auth.d.ts.map