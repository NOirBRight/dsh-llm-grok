/**
 * Host-owned xAI PKCE (S256) against the Grok CLI public client.
 * Tokens stay on the Host; this module never logs Authorization headers.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import type { GrokAuthStartReply } from './client-contract.ts'
import {
  deleteSession,
  readSession,
  writeSession,
} from './session.ts'
import type { GrokSession } from './session.ts'

/** Issuer used by the Grok CLI public client. */
export const GROK_OAUTH_ISSUER = 'https://auth.x.ai'
/** Public client_id from the Grok CLI auth.json key `https://auth.x.ai::<client_id>`. */
export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
/** Grok CLI documented OIDC scopes. `offline_access` is required for refresh. */
export const GROK_OAUTH_SCOPE = 'openid profile email offline_access api:access'
/** Pinned authorize path when OIDC discovery is unavailable. */
export const GROK_OAUTH_AUTHORIZE_PATH = '/oauth2/authorize'
/** Pinned token path when OIDC discovery is unavailable. */
export const GROK_OAUTH_TOKEN_PATH = '/oauth2/token'
/** How long the loopback listener waits for the browser callback. */
export const GROK_OAUTH_TIMEOUT_MS = 300_000
/** Refresh when the access token expires within this window. */
export const GROK_OAUTH_REFRESH_SKEW_MS = 60_000

/** Discovered or pinned OIDC endpoints. */
export interface GrokOidcEndpoints {
  /** Authorization-code endpoint. */
  authorizationEndpoint: string
  /** Token endpoint (code exchange and refresh). */
  tokenEndpoint: string
  /** Optional userinfo endpoint used when the id_token has no email. */
  userinfoEndpoint?: string
}

/** Injectable Host OAuth runtime. */
export interface GrokOAuthRuntime {
  /** Absolute `$DSH_HOME/grok-oauth.json` path. */
  resolveSessionPath: () => string
  /** OIDC issuer; production is {@link GROK_OAUTH_ISSUER}. */
  issuer: string
  /** Public OAuth client id. */
  clientId: string
  /** Space-delimited scope list. */
  scope: string
  /** Open the system browser to the authorize URL. */
  openBrowser: (url: string) => Promise<void>
  /** Fetch implementation used for discovery and token posts. */
  fetch: typeof fetch
  /** Clock used for expiry and refresh skew. */
  now: () => number
  /** Callback wait budget. */
  timeoutMs: number
  /** Refresh when remaining lifetime is below this many milliseconds. */
  refreshSkewMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function retryable(message: string): GrokAuthStartReply {
  return { ok: false, retryable: true, message }
}

function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

/** PKCE S256 pair plus a CSRF state. */
export function createPkcePair(): { verifier: string, challenge: string, state: string } {
  const verifier = randomUrlSafe(32)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, state: randomUrlSafe(16) }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  const payload = parts[1]
  if (parts.length < 2 || payload === undefined) return undefined
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const value = JSON.parse(json) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function joinUrl(issuer: string, path: string): string {
  return `${issuer.replace(/\/+$/u, '')}${path}`
}

/**
 * Discover authorize/token endpoints, falling back to the Grok CLI paths.
 * @param issuer - OIDC issuer origin.
 * @param fetchImpl - HTTP client.
 */
export async function discoverOidcEndpoints(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GrokOidcEndpoints> {
  const fallback: GrokOidcEndpoints = {
    authorizationEndpoint: joinUrl(issuer, GROK_OAUTH_AUTHORIZE_PATH),
    tokenEndpoint: joinUrl(issuer, GROK_OAUTH_TOKEN_PATH),
  }
  try {
    const response = await fetchImpl(joinUrl(issuer, '/.well-known/openid-configuration'), {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return fallback
    const body = await response.json() as unknown
    if (!isRecord(body)) return fallback
    const authorizationEndpoint = body['authorization_endpoint']
    const tokenEndpoint = body['token_endpoint']
    const userinfoEndpoint = body['userinfo_endpoint']
    if (typeof authorizationEndpoint !== 'string' || authorizationEndpoint.length === 0) return fallback
    if (typeof tokenEndpoint !== 'string' || tokenEndpoint.length === 0) return fallback
    return {
      authorizationEndpoint,
      tokenEndpoint,
      ...typeof userinfoEndpoint === 'string' && userinfoEndpoint.length > 0
        ? { userinfoEndpoint }
        : {},
    }
  } catch {
    return fallback
  }
}

function spawnDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Open the authorize URL with xdg-open, then sensible-open. */
export async function openSystemBrowser(url: string): Promise<void> {
  if (!/^https?:\/\//u.test(url)) throw new Error('refusing to open a non-http url')
  const commands = ['xdg-open', 'sensible-open']
  let last: unknown
  for (const command of commands) {
    try {
      await spawnDetached(command, [url])
      return
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error('could not open a system browser')
}

/**
 * Fill production defaults for the Host OAuth runtime.
 * @param overrides - required session path plus optional test fakes.
 */
export function createGrokAuthRuntime(
  overrides: Partial<GrokOAuthRuntime> & Pick<GrokOAuthRuntime, 'resolveSessionPath'>,
): GrokOAuthRuntime {
  return {
    issuer: GROK_OAUTH_ISSUER,
    clientId: GROK_OAUTH_CLIENT_ID,
    scope: GROK_OAUTH_SCOPE,
    openBrowser: openSystemBrowser,
    fetch,
    now: () => Date.now(),
    timeoutMs: GROK_OAUTH_TIMEOUT_MS,
    refreshSkewMs: GROK_OAUTH_REFRESH_SKEW_MS,
    ...overrides,
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function expiresAtFromTokens(body: Record<string, unknown>, now: number): string {
  const expiresIn = body['expires_in']
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(now + expiresIn * 1000).toISOString()
  }
  for (const token of [body['id_token'], body['access_token']]) {
    if (typeof token !== 'string') continue
    const exp = decodeJwtPayload(token)?.['exp']
    if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
      return new Date(exp * 1000).toISOString()
    }
  }
  return new Date(now).toISOString()
}

async function accountFromTokens(
  body: Record<string, unknown>,
  accessToken: string,
  userinfoEndpoint: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ email?: string, userId?: string }> {
  const idToken = readString(body, 'id_token')
  const claims = idToken === undefined ? undefined : decodeJwtPayload(idToken)
  let email = claims !== undefined ? readString(claims, 'email') : undefined
  let userId = claims !== undefined ? readString(claims, 'sub') : undefined
  if ((email === undefined || userId === undefined) && userinfoEndpoint !== undefined) {
    try {
      const response = await fetchImpl(userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      })
      if (response.ok) {
        const info = await response.json() as unknown
        if (isRecord(info)) {
          email ??= readString(info, 'email')
          userId ??= readString(info, 'sub')
        }
      }
    } catch {
      // Identity is optional; a missing userinfo answer is not a login failure.
    }
  }
  return {
    ...email === undefined ? {} : { email },
    ...userId === undefined ? {} : { userId },
  }
}

async function parseTokenResponse(
  response: Response,
  now: number,
  userinfoEndpoint: string | undefined,
  fetchImpl: typeof fetch,
  previous?: GrokSession,
): Promise<GrokSession | undefined> {
  if (!response.ok) return undefined
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return undefined
  }
  if (!isRecord(body)) return undefined
  const accessToken = readString(body, 'access_token')
  const refreshToken = readString(body, 'refresh_token') ?? previous?.refreshToken
  if (accessToken === undefined || refreshToken === undefined) return undefined
  const account = await accountFromTokens(body, accessToken, userinfoEndpoint, fetchImpl)
  const email = account.email ?? previous?.email
  const userId = account.userId ?? previous?.userId
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAtFromTokens(body, now),
    ...email === undefined ? {} : { email },
    ...userId === undefined ? {} : { userId },
  }
}

/**
 * Exchange a refresh token. Callers delete the session when this returns undefined.
 * @param runtime - Host OAuth runtime.
 * @param session - current session.
 */
export async function refreshSession(
  runtime: GrokOAuthRuntime,
  session: GrokSession,
): Promise<GrokSession | undefined> {
  const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch)
  let response: Response
  try {
    response = await runtime.fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: runtime.clientId,
      }),
    })
  } catch {
    return undefined
  }
  return parseTokenResponse(response, runtime.now(), endpoints.userinfoEndpoint, runtime.fetch, session)
}

/**
 * Return a session that is not near expiry, refreshing or clearing as needed.
 * @param runtime - Host OAuth runtime.
 */
export async function ensureFreshSession(runtime: GrokOAuthRuntime): Promise<GrokSession | undefined> {
  const path = runtime.resolveSessionPath()
  const session = await readSession(path)
  if (session === undefined) return undefined
  const remaining = Date.parse(session.expiresAt) - runtime.now()
  if (remaining > runtime.refreshSkewMs) return session
  const refreshed = await refreshSession(runtime, session)
  if (refreshed === undefined) {
    await deleteSession(path)
    return undefined
  }
  await writeSession(path, refreshed)
  return refreshed
}

type CallbackResult =
  | { kind: 'code', code: string }
  | { kind: 'mismatch' }
  | { kind: 'denied' }

const CALLBACK_OK = '<!doctype html><title>Grok</title><p>Sign-in complete. You can close this window.</p>'
const CALLBACK_FAIL = '<!doctype html><title>Grok</title><p>Sign-in did not complete. You can close this window and try again.</p>'

function listenLoopback(): Promise<{ server: Server, port: number }> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('loopback listener has no port'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => resolve())
  })
}

function waitForCallback(
  server: Server,
  expectedState: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: CallbackResult | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      server.removeListener('request', onRequest)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const onAbort = () => {
      finish(Object.assign(new Error('Sign-in was cancelled.'), { code: 'ABORT_ERR' }))
    }
    const timer = setTimeout(() => {
      finish(Object.assign(new Error('Sign-in timed out.'), { code: 'TIMEOUT' }))
    }, timeoutMs)
    const onRequest = (request: IncomingMessage, response: ServerResponse) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
          return
        }
        const state = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (state !== expectedState) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(CALLBACK_FAIL)
          finish({ kind: 'mismatch' })
          return
        }
        if (error !== null || code === null || code.length === 0) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(CALLBACK_FAIL)
          finish({ kind: 'denied' })
          return
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(CALLBACK_OK)
        finish({ kind: 'code', code })
      } catch (error) {
        response.writeHead(400).end()
        finish(error instanceof Error ? error : new Error('invalid callback'))
      }
    }
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    server.on('request', onRequest)
  })
}

const loginInFlight = new WeakSet<GrokOAuthRuntime>()

/**
 * Run one loopback PKCE sign-in. Cancel, timeout, and state mismatch leave
 * the session file untouched.
 * @param runtime - Host OAuth runtime.
 * @param signal - RPC abort signal.
 */
export async function startPkceLogin(
  runtime: GrokOAuthRuntime,
  signal?: AbortSignal,
): Promise<GrokAuthStartReply> {
  if (loginInFlight.has(runtime)) return retryable('Sign-in is already in progress.')
  loginInFlight.add(runtime)
  let server: Server | undefined
  const local = new AbortController()
  const onParentAbort = () => { local.abort() }
  signal?.addEventListener('abort', onParentAbort)
  try {
    if (signal?.aborted === true || local.signal.aborted) return retryable('Sign-in was cancelled.')
    const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch)
    const listener = await listenLoopback()
    server = listener.server
    const pkce = createPkcePair()
    const redirectUri = `http://127.0.0.1:${String(listener.port)}/callback`
    const authorize = new URL(endpoints.authorizationEndpoint)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('client_id', runtime.clientId)
    authorize.searchParams.set('redirect_uri', redirectUri)
    authorize.searchParams.set('scope', runtime.scope)
    authorize.searchParams.set('state', pkce.state)
    authorize.searchParams.set('code_challenge', pkce.challenge)
    authorize.searchParams.set('code_challenge_method', 'S256')
    const callback = waitForCallback(server, pkce.state, runtime.timeoutMs, local.signal)
    try {
      await runtime.openBrowser(authorize.toString())
    } catch {
      local.abort()
      await callback.catch(() => undefined)
      return retryable('Sign-in could not be completed.')
    }
    const result = await callback
    if (result.kind === 'mismatch') return retryable('Sign-in rejected a mismatched state.')
    if (result.kind === 'denied') return retryable('Sign-in did not complete.')
    const response = await runtime.fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: redirectUri,
        client_id: runtime.clientId,
        code_verifier: pkce.verifier,
      }),
    })
    const session = await parseTokenResponse(
      response,
      runtime.now(),
      endpoints.userinfoEndpoint,
      runtime.fetch,
    )
    if (session === undefined) return retryable('Sign-in could not be completed.')
    await writeSession(runtime.resolveSessionPath(), session)
    return { ok: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ABORT_ERR' || signal?.aborted === true || local.signal.aborted) {
      return retryable('Sign-in was cancelled.')
    }
    if (code === 'TIMEOUT') return retryable('Sign-in timed out.')
    return retryable('Sign-in could not be completed.')
  } finally {
    signal?.removeEventListener('abort', onParentAbort)
    if (server !== undefined) await closeServer(server)
    loginInFlight.delete(runtime)
  }
}
