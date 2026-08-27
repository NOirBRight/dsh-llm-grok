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
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_RPC_CHANNEL,
  GROK_SAVE_ENDPOINT,
  GROK_SETTINGS_NAMESPACE,
  GROK_USAGE_ENDPOINT,
  decodeGrokAuthStatus,
  decodeGrokSaveResult,
  decodeGrokUsageReply,
} from '../src/client-contract.ts'
import { apply, Config, createGrokRpcHandler, inject } from '../src/index.ts'
import { createGrokAuthRuntime } from '../src/oauth.ts'
import { readSession, resolveGrokSessionPath, writeSession } from '../src/session.ts'
import { closeFakeAuthServers, fakeAuthServer } from './fake-auth-server.ts'
import { closeFakeBillingServers, fakeBillingServer } from './fake-billing-server.ts'

afterEach(async () => {
  await closeFakeAuthServers()
  await closeFakeBillingServers()
})

type Handler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<{ ok: boolean, value?: unknown, error?: { message: string } }>

const tokens = {
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  expiresIn: 3600,
  email: 'user@example.test',
  userId: 'user-1',
}

describe('Grok loopback auth RPC', () => {
  it('registers /grok as a loopback channel', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime).await()
    const handle = vi.fn((_channel: string, _handler: Handler, _options: { authority: 'loopback' }) =>
      () => Promise.resolve())
    ctx.provide('connection', { rpc: { handle } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()

    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0]?.[0]).toBe(GROK_RPC_CHANNEL)
    expect(handle.mock.calls[0]?.[2]).toEqual({ authority: 'loopback' })

    await fiber.dispose()
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
      value: { attemptId: expect.any(String), authorizationUrl: expect.any(String) },
    })
    expect(JSON.stringify(started)).not.toMatch(/access-secret|refresh-secret/u)
    if (!started.ok) throw new Error('expected auth attempt')
    const challenge = started.value as { authorizationUrl: string }
    const parsed = new URL(challenge.authorizationUrl)
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

  it('returns unsupported when billing is missing or unrecognized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-rpc-usage-unsup-'))
    const path = join(root, 'grok-oauth.json')
    const billing = await fakeBillingServer([
      { status: 404, body: { error: 'not found' } },
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

    expect(await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)).toEqual({
      ok: true,
      value: { status: 'unsupported' },
    })
    expect(await handler(GROK_USAGE_ENDPOINT, {}, new AbortController().signal)).toEqual({
      ok: true,
      value: { status: 'unsupported' },
    })
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

describe('Grok settings/save RPC', () => {
  it('commits only the displayed catalog through one revision-fenced mutation', async () => {
    const current = {
      streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      models: [
        { id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true },
        { id: 'grok-4.5', name: 'Grok 4.5', thinking: true, vision: true },
      ],
    }
    let value = current
    let revision = 1
    const mutate = vi.fn(async (
      _ns: string,
      ops: readonly { op: string, path: readonly string[], value: unknown }[],
      expected: number,
    ) => {
      expect(expected).toBe(revision)
      const next = structuredClone(value) as Record<string, unknown>
      for (const op of ops) next[op.path[0] as string] = structuredClone(op.value)
      value = next as typeof current
      revision += 1
    })
    const settings = {
      register: () => ({
        get: () => value,
        watch: () => () => undefined,
        update: () => Promise.resolve(),
        replace: () => Promise.resolve(),
      }),
      describe: () => [{ ns: GROK_SETTINGS_NAMESPACE, value, revision }],
      mutate,
    }
    const ctx = new Context()
    await ctx.plugin(LlmRuntime).await()
    const handle = vi.fn((_channel: string, _handler: Handler, _options: { authority: 'loopback' }) =>
      () => Promise.resolve())
    ctx.provide('connection', { rpc: { handle } } as never)
    ctx.provide('settings', settings as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    const handler = handle.mock.calls[0]?.[1]
    if (handler === undefined) throw new Error('Grok RPC was not registered')

    const result = await handler(GROK_SAVE_ENDPOINT, {
      models: [{ id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true }],
      expectedRevision: 1,
    }, new AbortController().signal)

    expect(decodeGrokSaveResult(result.ok ? result.value : undefined)).toEqual({
      settings: {
        streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
        models: [{ id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true }],
        enableImageGen: false,
      },
      revision: 2,
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]?.[1]).toEqual([
      { op: 'set', path: ['models'], value: [{ id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true }] },
    ])
    expect(JSON.stringify(result)).not.toMatch(/accessToken|refreshToken|Bearer/u)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a save payload that tries to send token fields', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime).await()
    const handle = vi.fn((_channel: string, _handler: Handler, _options: { authority: 'loopback' }) =>
      () => Promise.resolve())
    ctx.provide('connection', { rpc: { handle } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    const handler = handle.mock.calls[0]?.[1]
    if (handler === undefined) throw new Error('Grok RPC was not registered')

    const result = await handler(GROK_SAVE_ENDPOINT, {
      models: [{ id: 'grok-4.6' }],
      expectedRevision: 1,
      accessToken: 'nope',
    }, new AbortController().signal)
    expect(result.ok).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
