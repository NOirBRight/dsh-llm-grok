#!/usr/bin/env node
/**
 * E2E for empty Grok Think rows.
 *
 * Default: drive the *installed* profile package through a scripted
 * Responses SSE that matches the Ollama-session tco_* flood.
 *
 * --live: one real cli-chat-proxy turn (uses $DSH_HOME/grok-oauth.json).
 * Never prints tokens.
 */
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createUserMessage, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'

const INSTALLED = join(homedir(), '.dsh/profiles/web/node_modules/dsh-llm-grok/lib/index.js')
const live = process.argv.includes('--live')

const grok = await import(pathToFileURL(INSTALLED).href)
const {
  GrokAdapter,
  GROK_CATALOG,
  GROK_CHAT_BASE_URL,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PACKED_REASONING_TYPE,
  createGrokAuthRuntime,
  resolveGrokAccessToken,
  sessionPathForHome,
} = grok

function fail(message) {
  console.error('FAIL ' + message)
  process.exitCode = 1
}

function ok(message) {
  console.log('ok  ' + message)
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function reasoningStarts(chunks) {
  return chunks.filter(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')
}

function reasoningEnds(chunks) {
  return chunks.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning')
}

function emptyReasoningEnds(chunks) {
  return reasoningEnds(chunks).filter(chunk => (chunk.block.text ?? '').trim() === '')
}

function request(overrides = {}) {
  return {
    provider: 'grok',
    model: 'grok-4.6',
    messages: [createUserMessage({
      content: [{ type: 'text', text: overrides.text ?? 'hi' }],
      source: { kind: 'user' },
    })],
    ...overrides.rest,
  }
}

function writeSse(response, events) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => {
    const type = typeof event.type === 'string' ? event.type : 'message'
    return 'event: ' + type + '\ndata: ' + JSON.stringify(event) + '\n\n'
  }).join(''))
}

async function listen(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return {
    url: 'http://127.0.0.1:' + address.port,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

async function runFixture() {
  const visible = {
    id: 'rs_resp',
    type: 'reasoning',
    status: 'completed',
    summary: [{ type: 'summary_text', text: 'visible think' }],
    encrypted_content: 'enc-rs',
  }
  const tco1 = {
    id: 'tco_resp_call-11',
    type: 'reasoning',
    status: 'completed',
    summary: [],
    encrypted_content: 'enc-tco-11',
  }
  const tco2 = {
    id: 'tco_resp_call-12',
    type: 'reasoning',
    status: 'completed',
    summary: [],
    encrypted_content: 'enc-tco-12',
  }
  const message = {
    id: 'msg_resp',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'hello' }],
  }
  const responseBody = {
    id: 'resp_1',
    status: 'completed',
    output: [visible, message, tco1, tco2],
    usage: { input_tokens: 10, output_tokens: 4, output_tokens_details: { reasoning_tokens: 3 } },
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...visible, status: 'in_progress', summary: [] } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'visible think' },
    { type: 'response.output_item.done', output_index: 0, item: visible },
    { type: 'response.output_item.added', output_index: 1, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 1, delta: 'hello' },
    { type: 'response.output_item.done', output_index: 1, item: message },
    { type: 'response.output_item.added', output_index: 2, item: { ...tco1, status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 2, item: tco1 },
    { type: 'response.output_item.added', output_index: 3, item: { ...tco2, status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 3, item: tco2 },
    { type: 'response.completed', response: responseBody },
  ]

  const requests = []
  const handler = (req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      let body = raw
      try { body = JSON.parse(raw) } catch { /* keep */ }
      requests.push({ path: req.url, body })
      writeSse(res, events)
    })
  }
  const server = await listen(handler)
  try {
    const adapter = new GrokAdapter({
      options: () => ({
        baseURL: server.url + '/v1',
        models: GROK_CATALOG,
        streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
        retryPolicy: resolveRetryPolicy(undefined, 'test'),
      }),
      resolveApiKey: () => Promise.resolve('test-access'),
    })
    const chunks = await collect(adapter.stream(request()))
    const starts = reasoningStarts(chunks)
    const ends = reasoningEnds(chunks)
    const empties = emptyReasoningEnds(chunks)
    if (starts.length !== 1) fail('expected 1 reasoning start, got ' + starts.length)
    else ok('one Think start')
    if (ends.length !== 1) fail('expected 1 reasoning end, got ' + ends.length)
    else ok('one Think end')
    if (empties.length !== 0) fail('expected 0 empty Think ends, got ' + empties.length)
    else ok('no empty Think ends')
    const finish = chunks.find(chunk => chunk.type === 'finish')
    const replay = finish && finish.replayState
    const packed = replay && replay.blocks ? replay.blocks.filter(block => block.type === 'reasoning') : []
    if (packed.length !== 1) fail('expected 1 replay reasoning block, got ' + packed.length)
    else ok('one replay reasoning block')
    let parsed
    try { parsed = JSON.parse(packed[0] && packed[0].thinkingSignature ? packed[0].thinkingSignature : '') } catch { parsed = null }
    if (!parsed || parsed.type !== GROK_PACKED_REASONING_TYPE) fail('replay not packed: ' + String(JSON.stringify(parsed)).slice(0, 120))
    else if (!parsed.items || parsed.items.length !== 3) fail('packed items ' + (parsed.items && parsed.items.length) + ', want 3')
    else if (parsed.items[1].id !== tco1.id || parsed.items[2].id !== tco2.id) fail('packed tco order wrong')
    else ok('tco_* items packed onto the visible Think')

    const second = await collect(adapter.stream(request({
      text: 'continue',
      rest: {
        messages: [
          createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
          {
            role: 'assistant',
            content: [{ type: 'reasoning', text: 'visible think' }, { type: 'text', text: 'hello' }],
            source: { kind: 'model', provider: 'grok', model: 'grok-4.6', replayState: replay },
          },
          createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
        ],
      },
    })))
    if (second.length === 0) fail('second turn produced no chunks')
    const input = requests[1] && requests[1].body && requests[1].body.input
    const ids = Array.isArray(input)
      ? input.map(item => item && typeof item === 'object' ? item.id : undefined).filter(Boolean)
      : []
    if (!ids.includes(visible.id) || !ids.includes(tco1.id) || !ids.includes(tco2.id)) {
      fail('second-turn input missing packed items: ' + ids.join(','))
    } else if (input.some(item => item && item.type === GROK_PACKED_REASONING_TYPE)) {
      fail('packed wrapper leaked onto the wire')
    } else {
      ok('second turn expands packed items onto input')
    }
  } finally {
    await server.close()
  }
}

async function runLive() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const runtime = createGrokAuthRuntime({
    resolveSessionPath: () => sessionPathForHome(home),
  })
  const adapter = new GrokAdapter({
    options: () => ({
      baseURL: GROK_CHAT_BASE_URL,
      models: GROK_CATALOG,
      streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      retryPolicy: resolveRetryPolicy(undefined, 'normal'),
    }),
    resolveApiKey: () => resolveGrokAccessToken(runtime),
  })
  const chunks = await collect(adapter.stream(request({
    text: 'Search the web for xAI grok-4.6 reasoning.effort official values. Reply with one short sentence.',
  })))
  const starts = reasoningStarts(chunks)
  const ends = reasoningEnds(chunks)
  const empties = emptyReasoningEnds(chunks)
  const finish = chunks.find(chunk => chunk.type === 'finish')
  const replay = finish && finish.replayState
  const reasoning = replay && replay.blocks ? replay.blocks.filter(block => block.type === 'reasoning') : []
  console.log('live starts=' + starts.length + ' ends=' + ends.length + ' emptyEnds=' + empties.length + ' replayReasoning=' + reasoning.length)
  if (empties.length !== 0) fail('live empty Think ends: ' + empties.length)
  else ok('live: no empty Think ends')
  if (starts.length !== ends.length) fail('live start/end mismatch ' + starts.length + '/' + ends.length)
  else ok('live: Think start/end paired')
  for (const block of reasoning) {
    const sig = block.thinkingSignature
    if (typeof sig !== 'string') continue
    try {
      const parsed = JSON.parse(sig)
      if (parsed && parsed.type === GROK_PACKED_REASONING_TYPE) {
        ok('live: packed ' + parsed.items.length + ' reasoning items onto visible Think')
        return
      }
      if (typeof parsed.id === 'string' && parsed.id.startsWith('tco_')) {
        fail('live: tco_* item still a standalone Think')
        return
      }
    } catch { /* ignore non-json signatures */ }
  }
  ok('live: no standalone tco_* Think (search may not have fired)')
}

console.log('using ' + INSTALLED)
console.log('packedType=' + GROK_PACKED_REASONING_TYPE)
if (live) await runLive()
else await runFixture()
if (process.exitCode) process.exit(process.exitCode)
