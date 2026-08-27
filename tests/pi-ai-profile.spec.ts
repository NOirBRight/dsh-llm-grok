import { describe, expect, it } from 'vitest'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { GROK_CATALOG } from '../src/client-contract.ts'
import { createGrokPiAiProfile } from '../src/pi-ai-profile.ts'

describe('createGrokPiAiProfile', () => {
  it('declares the rc.2 request-image budgets', () => {
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
