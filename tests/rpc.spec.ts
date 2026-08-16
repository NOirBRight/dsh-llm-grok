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
  GROK_RPC_CHANNEL,
  decodeGrokAuthStatus,
} from '../src/client-contract.ts'
import { apply, Config, createGrokRpcHandler, inject } from '../src/index.ts'
import { createGrokAuthRuntime } from '../src/oauth.ts'
import { readSession, resolveGrokSessionPath, writeSession } from '../src/session.ts'
import { closeFakeAuthServers, fakeAuthServer } from './fake-auth-server.ts'

afterEach(async () => {
  await closeFakeAuthServers()
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
    const result = await handler('usage/read', {}, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('unknown Grok endpoint: usage/read')
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
      openBrowser: async (url) => {
        const parsed = new URL(url)
        auth.expectedChallenge = parsed.searchParams.get('code_challenge') ?? undefined
        await fetch(`${parsed.searchParams.get('redirect_uri')}?code=${auth.nextCode}&state=${parsed.searchParams.get('state')}`)
      },
    })
    const handler = createGrokRpcHandler(runtime)

    const started = await handler(GROK_AUTH_START_ENDPOINT, {}, new AbortController().signal)
    expect(started).toEqual({ ok: true, value: { ok: true } })
    expect(JSON.stringify(started)).not.toMatch(/access-secret|refresh-secret/u)

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
