/** Local cli-chat-proxy stand-in. Never talks to cli-chat-proxy.grok.com. */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type FakeProxyBehavior =
  | { kind: 'sse', events: object[] }
  | { kind: 'json', status: number, body: unknown }

export interface FakeProxyRequest {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: unknown
}

export interface FakeProxy {
  url: string
  requests: FakeProxyRequest[]
  close(): Promise<void>
}

const servers: ReturnType<typeof createServer>[] = []

/** Close every fake proxy opened since the last call. */
export async function closeFakeProxies(): Promise<void> {
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

function writeSse(response: ServerResponse, events: object[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => {
    const type = typeof (event as { type?: unknown }).type === 'string'
      ? (event as { type: string }).type
      : 'message'
    return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`
  }).join(''))
}

/** Replay scripted Responses answers and record outbound request shape. */
export async function fakeChatProxy(script: FakeProxyBehavior[]): Promise<FakeProxy> {
  const requests: FakeProxyRequest[] = []
  const pending = [...script]
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readBody(request).then((raw) => {
      let body: unknown = raw
      try { body = JSON.parse(raw) as unknown } catch { /* keep raw */ }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      requests.push({
        method: request.method ?? 'GET',
        path: url.pathname,
        headers: request.headers,
        body,
      })
      const behavior = pending.shift()
      if (behavior === undefined) {
        response.writeHead(500).end('fake proxy script exhausted')
        return
      }
      if (behavior.kind === 'json') {
        response.writeHead(behavior.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(behavior.body))
        return
      }
      writeSse(response, behavior.events)
    }).catch(() => {
      response.writeHead(400).end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake proxy address unavailable')
  servers.push(server)
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
