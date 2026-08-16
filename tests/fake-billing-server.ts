/** Local billing stand-in for Grok usage tests. Never talks to xAI. */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export interface FakeBillingRequest {
  method?: string
  url?: string
  authorization?: string
}

export interface FakeBillingBehavior {
  status: number
  body?: unknown
  reset?: boolean
}

export interface FakeBillingServer {
  /** Full GET target, including `/v1/billing`. */
  url: string
  requests: FakeBillingRequest[]
  script: FakeBillingBehavior[]
  close(): Promise<void>
}

const servers: Server[] = []

export async function closeFakeBillingServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve())
  })))
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

export async function fakeBillingServer(
  script: FakeBillingBehavior[] = [],
): Promise<FakeBillingServer> {
  const state: FakeBillingServer = {
    url: '',
    requests: [],
    script: [...script],
    close: async () => undefined,
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    state.requests.push({
      method: request.method,
      url: request.url,
      ...request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization },
    })
    const behavior = state.script.shift()
    if (behavior === undefined) {
      response.writeHead(500).end('billing script exhausted')
      return
    }
    if (behavior.reset === true) {
      request.socket.destroy()
      return
    }
    sendJson(response, behavior.status, behavior.body ?? {})
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake billing server has no port')
  state.url = `http://127.0.0.1:${String(address.port)}/v1/billing`
  servers.push(server)
  state.close = () => new Promise<void>(resolve => {
    server.close(() => resolve())
  })
  return state
}
