import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import {
  GROK_AUTH_LOGOUT_ENDPOINT,
  GROK_AUTH_START_ENDPOINT,
  GROK_AUTH_STATUS_ENDPOINT,
  GROK_USAGE_ENDPOINT,
  GROK_RPC_METHOD,
  decodeGrokAuthStartReply,
  decodeGrokAuthStatus,
  decodeGrokUsageReply,
} from '../src/client-contract.ts'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { apply, Config, createGrokRpcHandler, inject } from '../src/index.ts'
import { createGrokAuthRuntime } from '../src/oauth.ts'
import { readSession, resolveGrokSessionPath, writeSession } from '../src/session.ts'
import { closeFakeAuthServers, fakeAuthServer } from './fake-auth-server.ts'
import { closeFakeBillingServers, fakeBillingServer } from './fake-billing-server.ts'

afterEach(async () => {
  await closeFakeAuthServers()
  await closeFakeBillingServers()
})


const tokens = {
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  expiresIn: 3600,
  email: 'user@example.test',
  userId: 'user-1',
}

describe('Grok authenticated Host Connection RPC', () => {
  it('registers one authenticated /api route and disposes only that route', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime).await()
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    const dispose = vi.fn(async () => { await pending })
    const register = vi.fn((_route: ConnectionFetchRoute) => dispose)
    ctx.provide('connection', { operator: {}, fetch: { register } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()

    expect(register).toHaveBeenCalledTimes(1)
    const route = register.mock.calls[0]?.[0]
    expect(route?.path).toBe('/api/plugin-rpc/grok')
    expect(route?.methods).toEqual(['POST'])
    expect(route?.requestBody).toBe('buffered')

    const unloading = fiber.dispose()
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
    let settled = false
    void unloading.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release?.()
    await unloading
    await ctx.fiber.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('dispatches wrapped requests with an omitted undefined payload', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime).await()
    const register = vi.fn((_route: ConnectionFetchRoute) => () => Promise.resolve())
    ctx.provide('connection', { operator: {}, fetch: { register } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    const route = register.mock.calls[0]?.[0]
    if (route === undefined) throw new Error('Grok Fetch route was not registered')

    const response = await route.fetch(new Request('http://localhost/api/plugin-rpc/grok', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'grok-test',
        method: GROK_RPC_METHOD,
        payload: { endpoint: 'unknown' },
      }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      type: 'server-response',
      rpcId: 'grok-test',
      result: { ok: false, error: { code: 'internal' } },
    })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('unloads an injected connection fiber when route registration fails', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime).await()
    const failure = new Error('route registration failed')
    const logged = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
    const register = vi.fn((_route: ConnectionFetchRoute) => { throw failure })
    ctx.provide('connection', { operator: {}, fetch: { register } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    expect(logged).toHaveBeenCalledWith(failure)
    await expect(fiber.dispose()).resolves.toBeUndefined()
    expect(register).toHaveBeenCalledTimes(1)
    logged.mockRestore()
    await ctx.fiber.dispose()
  })

  it('returns status without token fields and logout deletes the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-'))
    const path = join(root, 'grok-oauth.json')
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt,
      email: 'user@example.test',
      userId: 'user-1',
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }))

    const status = await handler(GROK_AUTH_STATUS_ENDPOINT, {}, new AbortController().signal)
    expect(status).toEqual({
      ok: true,
      value: { loggedIn: true, email: 'user@example.test', expiresAt },
    })
    expect(JSON.stringify(status)).not.toMatch(/access|refresh|token/iu)
    expect(decodeGrokAuthStatus(status.ok ? status.value : undefined)).toEqual({
      loggedIn: true,
      email: 'user@example.test',
      expiresAt,
    })

    const loggedOut = await handler(GROK_AUTH_LOGOUT_ENDPOINT, {}, new AbortController().signal)
    expect(loggedOut).toEqual({ ok: true, value: { ok: true } })
    expect(await readSession(path)).toBeUndefined()
    expect(await handler(GROK_AUTH_STATUS_ENDPOINT, {}, new AbortController().signal)).toEqual({
      ok: true,
      value: { loggedIn: false },
    })
  })

  it('refreshes an expiring session on status and never returns tokens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-refresh-'))
    const path = join(root, 'grok-oauth.json')
    const auth = await fakeAuthServer({
      authorizationCode: tokens,
      refresh: {
        accessToken: 'access-two',
        refreshToken: 'refresh-two',
        expiresIn: 3600,
        email: 'user@example.test',
        userId: 'user-1',
      },
    })
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(0).toISOString(),
      email: 'user@example.test',
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
    }))

    const status = await handler(GROK_AUTH_STATUS_ENDPOINT, {}, new AbortController().signal)
    expect(status.ok).toBe(true)
    expect(status).toMatchObject({
      ok: true,
      value: { loggedIn: true, email: 'user@example.test' },
    })
    expect(JSON.stringify(status)).not.toMatch(/access-secret|refresh-secret|access-two|refresh-two/u)
    expect(await readSession(path)).toMatchObject({ accessToken: 'access-two', refreshToken: 'refresh-two' })
  })

  it('rejects status snapshots that carry token fields', () => {
    expect(decodeGrokAuthStatus({
      loggedIn: true,
      email: 'user@example.test',
      accessToken: 'secret',
    })).toBeUndefined()
    expect(decodeGrokAuthStatus({ loggedIn: false })).toEqual({ loggedIn: false })
  })

  it('rejects unknown endpoints as internal errors', async () => {
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => join(tmpdir(), 'unused-grok-oauth.json'),
    }))
    const result = await handler('models/discover', {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('unknown Grok endpoint: models/discover')
  })

  it('rejects status payloads that try to send token fields', async () => {
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => join(tmpdir(), 'unused-grok-oauth.json'),
    }))
    const result = await handler(
      GROK_AUTH_STATUS_ENDPOINT,
      { accessToken: 'nope' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
  })

  it('starts PKCE through the RPC handler and then reports logged-in status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-start-'))
    const path = join(root, 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      timeoutMs: 2_000,
    })
    const handler = createGrokRpcHandler(runtime)

    const started = await handler(GROK_AUTH_START_ENDPOINT, {}, new AbortController().signal)
    expect(started).toMatchObject({
      ok: true,
      value: { ok: true, attemptId: expect.any(String), authorizationUrl: expect.any(String) },
    })
    expect(JSON.stringify(started)).not.toMatch(/access-secret|refresh-secret/u)
    if (!started.ok) throw new Error('expected auth attempt')
    const rawChallenge = started.value as { ok: true, attemptId: string, authorizationUrl: string }
    const decoded = decodeGrokAuthStartReply({ ...rawChallenge, authorizationUrl: 'https://auth.x.ai/oauth2/authorize' })
    expect(decoded).toMatchObject({ ok: true, attemptId: rawChallenge.attemptId })
    const parsed = new URL(rawChallenge.authorizationUrl)
    auth.expectedChallenge = parsed.searchParams.get('code_challenge') ?? undefined
    await fetch(`${parsed.searchParams.get('redirect_uri')}?code=${auth.nextCode}&state=${parsed.searchParams.get('state')}`)
    await vi.waitFor(async () => { expect(await readSession(path)).toBeDefined() })

    const status = await handler(GROK_AUTH_STATUS_ENDPOINT, {}, new AbortController().signal)
    expect(status).toEqual({
      ok: true,
      value: {
        loggedIn: true,
        email: 'user@example.test',
        expiresAt: expect.any(String),
      },
    })
    expect(JSON.stringify(status)).not.toMatch(/access-secret|refresh-secret/u)
  })

  it('returns logged-out usage without contacting billing', async () => {
    const fetchImpl = vi.fn()
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => join(tmpdir(), 'missing-grok-oauth.json'),
      fetch: fetchImpl,
    }), { billingURL: 'http://127.0.0.1:1/v1/billing' })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: { status: 'logged-out' } })
    expect(decodeGrokUsageReply(result.ok ? result.value : undefined)).toEqual({ status: 'logged-out' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // Resolving the stored session is the usage branch's first Host-side step, so a
  // throw there covers "answer a typed result, never reject the handler" for both
  // error classes: an LlmError keeps its own code, anything else is internal.
  it('answers a failure thrown while resolving the session, preserving its code', async () => {
    const throttled = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => { throw new LlmError('llm-grok: the issuer asked for a slower retry', 'RATE_LIMIT') },
    }))
    const rejected = await throttled(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(rejected.ok).toBe(false)
    expect(rejected.error?.code).toBe('RATE_LIMIT')
    expect(rejected.error?.message).toBe('llm-grok: the issuer asked for a slower retry')

    const broken = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => { throw new Error('llm-grok: the session file is unreadable') },
    }))
    const result = await broken(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('internal')
  })

  it('answers a billing credential rejection as INVALID_CREDENTIAL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-401-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([{ status: 401, body: { error: 'invalid token' } }])
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: billing.url })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('INVALID_CREDENTIAL')
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret/u)
  })

  it('keeps a billing 5xx out of the credential class', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-500-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([{ status: 500, body: { error: 'internal' } }])
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: billing.url })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('internal')
  })

  it('returns decoded billing windows and never includes tokens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([{
      status: 200,
      body: { windows: [{ id: 'monthly', used: 12, limit: 100, period: 'month' }] },
    }])
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      email: 'user@example.test',
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: billing.url })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'ok',
        usage: {
          fetchedAt: expect.any(String),
          windows: [{ id: 'monthly', used: 12, limit: 100, period: 'month' }],
        },
      },
    })
    expect(decodeGrokUsageReply(result.ok ? result.value : undefined)).toMatchObject({
      status: 'ok',
      usage: { windows: [{ id: 'monthly', used: 12, limit: 100, period: 'month' }] },
    })
    expect(billing.requests[0]?.authorization).toBe('Bearer access-secret')
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret|Bearer/u)
  })

  it('returns unsupported only when billing is missing (404)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-unsup-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([
      { status: 404, body: { error: 'not found' } },
    ])
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: billing.url })

    expect(await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)).toEqual({
      ok: true,
      value: { status: 'unsupported' },
    })
  })

  it('returns an error (not unsupported) when billing answers unrecognized 200 JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-unknown-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([
      { status: 200, body: { quota: 1 } },
    ])
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: billing.url })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/unrecognized billing surface/u)
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret/u)
  })

  it('returns an error (not quota) when billing answers an out-of-range percent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-range-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([{
      status: 200,
      body: {
        config: {
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
          creditUsagePercent: -5,
        },
      },
    }])
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: billing.url })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/unrecognized billing surface/u)
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret/u)
  })

  it('returns a transport error without token material', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-err-'))
    const path = join(root, 'grok-oauth.json')
    await writeSession(path, {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: 'http://127.0.0.1:1',
    }), { billingURL: 'http://127.0.0.1:1/v1/billing' })

    const result = await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('internal')
    expect(result.error?.message).toMatch(/could not reach/u)
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret/u)
  })

  it('rejects usage payloads that try to send token fields', async () => {
    const fetchImpl = vi.fn()
    const handler = createGrokRpcHandler(createGrokAuthRuntime({
      resolveSessionPath: () => join(tmpdir(), 'unused-grok-oauth.json'),
      fetch: fetchImpl,
    }))
    const result = await handler(
      GROK_USAGE_ENDPOINT,
      { accessToken: 'nope' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('resolves the session file from the launch-environment DSH_HOME', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-home-'))
    const ctx = new Context()
    ctx.provide(
      'launchEnvironment',
      createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: root } }]),
    )
    expect(resolveGrokSessionPath(ctx)).toBe(join(root, 'grok-oauth.json'))
  })
})
