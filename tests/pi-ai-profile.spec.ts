import { describe, expect, it } from 'vitest'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { GROK_CATALOG } from '../src/client-contract.ts'
import { createGrokPiAiProfile } from '../src/pi-ai-profile.ts'

describe('createGrokPiAiProfile modelErrors', () => {
  it('exposes an empty modelErrors map for the host modelOf path', () => {
    const profile = createGrokPiAiProfile({
      baseURL: 'https://cli-chat-proxy.grok.com/v1',
      models: GROK_CATALOG,
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'test'),
    })
    // Mirrors PiAiAdapter.modelOf: unconditional profile.modelErrors.get(model).
    expect(profile.modelErrors).toBeInstanceOf(Map)
    expect(profile.modelErrors.size).toBe(0)
    for (const model of GROK_CATALOG) {
      expect(profile.modelErrors.get(model.id)).toBeUndefined()
    }
  })
})

describe('createGrokPiAiProfile', () => {
  it('declares the request-image budgets', () => {
    const profile = createGrokPiAiProfile({
      baseURL: 'https://cli-chat-proxy.grok.com/v1',
      models: GROK_CATALOG,
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'test'),
    })

    expect(profile).toMatchObject({
      maxRequestImageBytes: 20 * 1024 * 1024,
      requestImagePixelBudget: 2048 * 2048,
      requestImageMaxBytes: 1024 * 1024,
    })
  })
})
