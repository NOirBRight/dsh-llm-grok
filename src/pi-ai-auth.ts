/**
 * In-memory pi-ai auth injection for Grok's request-scoped subscription route.
 *
 * Grok resolves its access token through `resolveApiKey` for each request, so the
 * store starts empty. It remains available for a future login flow without using
 * pi-ai's per-collection default store.
 *
 * @module dsh-llm-grok/pi-ai-auth
 */

import type { AuthContext, Credential, CredentialStore } from '@earendil-works/pi-ai'

type PiAiAuthInjection = {
  credentials: CredentialStore
  authContext: AuthContext
}

/**
 * Create the auth injectables for a Grok pi-ai collection.
 *
 * The credential store retains records in memory for the lifetime of the
 * returned injection. Ambient provider lookups are deliberately disabled.
 *
 * @returns an in-memory credential store and a finds-nothing auth context.
 */
export function createGrokPiAiAuth(): PiAiAuthInjection {
  const stored = new Map<string, Credential>()
  return {
    credentials: {
      read: id => Promise.resolve(stored.get(id)),
      list: () => Promise.resolve([...stored].map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }))),
      async modify(id, mutate) {
        const next = await mutate(stored.get(id))
        if (next !== undefined) stored.set(id, next)
        return stored.get(id)
      },
      delete: (id) => {
        stored.delete(id)
        return Promise.resolve()
      },
    },
    authContext: {
      env: () => Promise.resolve(undefined),
      fileExists: () => Promise.resolve(false),
    },
  }
}
