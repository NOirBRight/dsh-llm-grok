import { describe, expect, it } from 'vitest'
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'
import {
  GrokServerSearchCallFilter,
  isGrokServerSearchToolCallId,
  stripGrokServerSearchToolCalls,
} from '../src/server-search-calls.ts'

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-responses',
    provider: 'openai',
    model: 'grok-4.6',
    usage,
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

describe('isGrokServerSearchToolCallId', () => {
  it('matches Grok server-search call_id prefixes', () => {
    expect(isGrokServerSearchToolCallId(
      'xs_call-15cb054d-c176-422c-9a50-52720939fc1c-3|ctc_abc_call-15cb054d-c176-422c-9a50-52720939fc1c-3',
    )).toBe(true)
    expect(isGrokServerSearchToolCallId('ws_call-1|ctc_1')).toBe(true)
    expect(isGrokServerSearchToolCallId('web_search_call-9')).toBe(true)
  })

  it('leaves real DSH function calls alone', () => {
    expect(isGrokServerSearchToolCallId('call_run_code_1|fc_1')).toBe(false)
    expect(isGrokServerSearchToolCallId('run_code')).toBe(false)
    expect(isGrokServerSearchToolCallId(undefined)).toBe(false)
  })
})

describe('stripGrokServerSearchToolCalls', () => {
  it('drops xs_call echoes and relaxes toolUse to stop', () => {
    const stripped = stripGrokServerSearchToolCalls(message({
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'searching' },
        { type: 'text', text: 'hello' },
        {
          type: 'toolCall',
          id: 'xs_call-abc-3|ctc_abc-3',
          name: 'x_keyword_search',
          arguments: { input: '{"query":"grok"}' },
        },
        {
          type: 'toolCall',
          id: 'xs_call-abc-4|ctc_abc-4',
          name: 'x_semantic_search',
          arguments: { input: '{"query":"xhigh"}' },
        },
      ],
    }))
    expect(stripped.content.map(block => block.type)).toEqual(['thinking', 'text'])
    expect(stripped.stopReason).toBe('stop')
  })

  it('keeps run_code and leaves toolUse when a real call remains', () => {
    const stripped = stripGrokServerSearchToolCalls(message({
      stopReason: 'toolUse',
      content: [
        {
          type: 'toolCall',
          id: 'xs_call-abc-3|ctc_abc-3',
          name: 'x_keyword_search',
          arguments: {},
        },
        {
          type: 'toolCall',
          id: 'call_1|fc_1',
          name: 'run_code',
          arguments: { code: 'return 1' },
        },
      ],
    }))
    expect(stripped.content).toEqual([
      { type: 'toolCall', id: 'call_1|fc_1', name: 'run_code', arguments: { code: 'return 1' } },
    ])
    expect(stripped.stopReason).toBe('toolUse')
  })
})

describe('GrokServerSearchCallFilter', () => {
  it('does not emit toolcall events for xs_call echoes', () => {
    const filter = new GrokServerSearchCallFilter()
    const xs = {
      type: 'toolCall' as const,
      id: 'xs_call-abc-3|ctc_abc-3',
      name: 'x_keyword_search',
      arguments: { input: '{"query":"grok"}' },
    }
    const run = {
      type: 'toolCall' as const,
      id: 'call_1|fc_1',
      name: 'run_code',
      arguments: { code: 'return 1' },
    }
    const partial = message({ content: [xs, run], stopReason: 'toolUse' })
    const events: AssistantMessageEvent[] = [
      { type: 'toolcall_start', contentIndex: 0, partial },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{"query"', partial },
      { type: 'toolcall_end', contentIndex: 0, toolCall: xs, partial },
      { type: 'toolcall_start', contentIndex: 1, partial },
      { type: 'toolcall_end', contentIndex: 1, toolCall: run, partial },
      { type: 'done', reason: 'toolUse', message: partial },
    ]
    const out = events.flatMap(event => filter.take(event))
    expect(out.map(event => event.type)).toEqual(['toolcall_start', 'toolcall_end', 'done'])
    const done = out[2]
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse')
      expect(done.message.content).toEqual([run])
    }
  })
})
