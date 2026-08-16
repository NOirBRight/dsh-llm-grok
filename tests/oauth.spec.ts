import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  completePkceLogin,
  createGrokAuthRuntime,
  ensureFreshSession,
  startPkceLogin,
} from '../src/oauth.ts'
import { decodeGrokSession, readSession, writeSession } from '../src/session.ts'
import { closeFakeAuthServers, fakeAuthServer } from './fake-auth-server.ts'

afterEach(async () => {
  await closeFakeAuthServers()
})

const tokens = {
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
  expiresIn: 3600,
  email: 'user@example.test',
  userId: 'user-1',
}

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-llm-grok-oauth-'))
}

describe('Host-owned xAI PKCE', () => {
  it('writes a 0600 session after a matching code exchange', async () => {
    const root = await home()
    const path = join(root, 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      timeoutMs: 2_000,
      openBrowser: async (url) => {
        const parsed = new URL(url)
        expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
        expect(parsed.searchParams.get('client_id')).toBe('b1a00492-073a-47ea-816f-4c329264a828')
        expect(parsed.searchParams.get('scope') ?? '').toContain('grok-cli:access')
        auth.expectedChallenge = parsed.searchParams.get('code_challenge') ?? undefined
        const redirect = parsed.searchParams.get('redirect_uri')
        const state = parsed.searchParams.get('state')
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/u)
        await fetch(`${redirect}?code=${auth.nextCode}&state=${state}`)
      },
    })

    expect(await startPkceLogin(runtime)).toEqual({ ok: true })

    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o600)
    const session = decodeGrokSession(JSON.parse(await readFile(path, 'utf8')) as unknown)
    expect(session).toMatchObject({
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      email: 'user@example.test',
      userId: 'user-1',
    })
    expect(session?.expiresAt).toEqual(expect.any(String))
    const exchange = auth.requests.find(request => request.body.get('grant_type') === 'authorization_code')
    expect(exchange?.body.get('code_verifier')).toEqual(expect.any(String))
    expect(exchange?.body.has('client_secret')).toBe(false)
  })

  it('writes no session when the callback state does not match', async () => {
    const path = join(await home(), 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      timeoutMs: 2_000,
      openBrowser: async (url) => {
        const parsed = new URL(url)
        const redirect = parsed.searchParams.get('redirect_uri')
        await fetch(`${redirect}?code=${auth.nextCode}&state=wrong-state`)
      },
    })

    expect(await startPkceLogin(runtime)).toEqual({
      ok: false,
      retryable: true,
      message: 'Sign-in rejected a mismatched state.',
    })
    expect(await readSession(path)).toBeUndefined()
    expect(auth.requests).toEqual([])
  })

  it('writes no session on timeout', async () => {
    const path = join(await home(), 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      timeoutMs: 30,
      openBrowser: async () => undefined,
    })

    expect(await startPkceLogin(runtime)).toEqual({
      ok: false,
      retryable: true,
      message: 'Sign-in timed out.',
    })
    expect(await readSession(path)).toBeUndefined()
  })

  it('writes no session when the RPC is cancelled', async () => {
    const path = join(await home(), 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens })
    const abort = new AbortController()
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      timeoutMs: 2_000,
      openBrowser: async () => { abort.abort() },
    })

    expect(await startPkceLogin(runtime, abort.signal)).toEqual({
      ok: false,
      retryable: true,
      message: 'Sign-in was cancelled.',
    })
    expect(await readSession(path)).toBeUndefined()
  })

  it('exchanges a pasted Grok Build code without a loopback callback', async () => {
    const path = join(await home(), 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      timeoutMs: 2_000,
      openBrowser: async (url) => {
        const parsed = new URL(url)
        auth.expectedChallenge = parsed.searchParams.get('code_challenge') ?? undefined
        const completed = await completePkceLogin(runtime, auth.nextCode)
        expect(completed).toEqual({ ok: true })
      },
    })

    expect(await startPkceLogin(runtime)).toEqual({ ok: true })
    const session = await readSession(path)
    expect(session).toMatchObject({
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      email: 'user@example.test',
    })
    const exchange = auth.requests.find(request => request.body.get('grant_type') === 'authorization_code')
    expect(exchange?.body.get('code')).toBe(auth.nextCode)
  })
})

describe('Host-side token refresh', () => {
  it('replaces expired tokens and keeps the session file', async () => {
    const path = join(await home(), 'grok-oauth.json')
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
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      expiresAt: new Date(0).toISOString(),
      email: 'user@example.test',
      userId: 'user-1',
    })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
      now: () => Date.now(),
    })

    const next = await ensureFreshSession(runtime)
    expect(next).toMatchObject({
      accessToken: 'access-two',
      refreshToken: 'refresh-two',
      email: 'user@example.test',
    })
    expect(await readSession(path)).toMatchObject({ accessToken: 'access-two', refreshToken: 'refresh-two' })
  })

  it('clears the session when refresh fails', async () => {
    const path = join(await home(), 'grok-oauth.json')
    const auth = await fakeAuthServer({ authorizationCode: tokens, refresh: { fail: true } })
    await writeSession(path, {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      expiresAt: new Date(0).toISOString(),
      email: 'user@example.test',
    })
    const runtime = createGrokAuthRuntime({
      resolveSessionPath: () => path,
      issuer: auth.issuer,
    })

    expect(await ensureFreshSession(runtime)).toBeUndefined()
    expect(await readSession(path)).toBeUndefined()
  })
})
