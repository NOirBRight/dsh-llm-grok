/** Local OIDC stand-in for Grok PKCE tests. Never talks to auth.x.ai. */

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export interface FakeTokenSet {
  accessToken: string
  refreshToken: string
  expiresIn: number
  email?: string
  userId?: string
}

export interface FakeAuthServer {
  issuer: string
  requests: Array<{ path: string, body: URLSearchParams }>
  expectedChallenge: string | undefined
  nextCode: string
  authorizationCode: FakeTokenSet
  refresh: FakeTokenSet | { fail: true }
  close(): Promise<void>
}

const servers: Server[] = []

export async function closeFakeAuthServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve())
  })))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function tokenPayload(tokens: FakeTokenSet): Record<string, unknown> {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: 'Bearer',
    expires_in: tokens.expiresIn,
    id_token: jwt({
      email: tokens.email,
      sub: tokens.userId,
      exp: Math.floor(Date.now() / 1000) + tokens.expiresIn,
    }),
  }
}

export async function fakeAuthServer(init: {
  authorizationCode: FakeTokenSet
  refresh?: FakeTokenSet | { fail: true }
  clientId?: string
}): Promise<FakeAuthServer> {
  const state: FakeAuthServer = {
    issuer: '',
    requests: [],
    expectedChallenge: undefined,
    nextCode: 'auth-code',
    authorizationCode: init.authorizationCode,
    refresh: init.refresh ?? {
      accessToken: 'refreshed-access',
      refreshToken: 'refreshed-refresh',
      expiresIn: 3600,
      ...init.authorizationCode.email === undefined ? {} : { email: init.authorizationCode.email },
      ...init.authorizationCode.userId === undefined ? {} : { userId: init.authorizationCode.userId },
    },
    close: async () => undefined,
  }
  const clientId = init.clientId ?? 'b1a00492-073a-47ea-816f-4c329264a828'
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        sendJson(response, 200, {
          issuer: state.issuer,
          authorization_endpoint: `${state.issuer}/oauth2/authorize`,
          token_endpoint: `${state.issuer}/oauth2/token`,
        })
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/oauth2/token') {
        response.writeHead(404).end()
        return
      }
      const body = new URLSearchParams(await readBody(request))
      state.requests.push({ path: url.pathname, body })
      if (body.get('client_id') !== clientId) {
        sendJson(response, 400, { error: 'invalid_client' })
        return
      }
      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') !== state.nextCode) {
          sendJson(response, 400, { error: 'invalid_grant' })
          return
        }
        const verifier = body.get('code_verifier') ?? ''
        if (state.expectedChallenge !== undefined && challengeOf(verifier) !== state.expectedChallenge) {
          sendJson(response, 400, { error: 'invalid_grant' })
          return
        }
        sendJson(response, 200, tokenPayload(state.authorizationCode))
        return
      }
      if (body.get('grant_type') === 'refresh_token') {
        if ('fail' in state.refresh) {
          sendJson(response, 400, { error: 'invalid_grant' })
          return
        }
        if (body.get('refresh_token') !== init.authorizationCode.refreshToken
          && body.get('refresh_token') !== state.refresh.refreshToken) {
          sendJson(response, 400, { error: 'invalid_grant' })
          return
        }
        sendJson(response, 200, tokenPayload(state.refresh))
        return
      }
      sendJson(response, 400, { error: 'unsupported_grant_type' })
    })().catch(() => {
      if (!response.writableEnded) response.writeHead(500).end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake auth server has no port')
  state.issuer = `http://127.0.0.1:${String(address.port)}`
  servers.push(server)
  state.close = () => new Promise<void>(resolve => server.close(() => resolve()))
  return state
}
