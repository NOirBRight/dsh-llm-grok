import { describe, expect, it } from 'vitest'
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'
import {
  GROK_PACKED_REASONING_TYPE,
  GrokThinkingFilter,
  expandPackedGrokReasoningInput,
  isDisplayableThinking,
  packGrokThinkingBlocks,
} from '../src/reasoning-display.ts'

function thinking(text: string, item: unknown) {
  return {
    type: 'thinking' as const,
    thinking: text,
    thinkingSignature: JSON.stringify(item),
  }
}

const visible = {
  id: 'rs_visible',
  type: 'reasoning',
  status: 'completed',
  summary: [{ type: 'summary_text', text: 'visible think' }],
  encrypted_content: 'enc-rs',
}

const tco = (n: number) => ({
  id: `tco_resp_call-${n}`,
  type: 'reasoning',
  status: 'completed',
  summary: [],
  encrypted_content: `enc-tco-${n}`,
})

describe('isDisplayableThinking', () => {
  it('rejects empty and whitespace-only summaries', () => {
    expect(isDisplayableThinking('')).toBe(false)
    expect(isDisplayableThinking('\n\n')).toBe(false)
    expect(isDisplayableThinking(' visible ')).toBe(true)
  })
})

describe('packGrokThinkingBlocks', () => {
  it('packs empty tco reasoning onto the visible Think block, in order', () => {
    const packed = packGrokThinkingBlocks([
      thinking('visible think', visible),
      thinking('', tco(11)),
      thinking('', tco(12)),
      { type: 'text', text: 'hello' },
      { type: 'toolCall', id: 'call-1', name: 'run_code', arguments: {} },
    ])

    expect(packed.map(block => block.type)).toEqual(['thinking', 'text', 'toolCall'])
    const block = packed[0]
    expect(block?.type).toBe('thinking')
    expect(block && 'thinking' in block ? block.thinking : undefined).toBe('visible think')
    expect(JSON.parse(block && 'thinkingSignature' in block ? block.thinkingSignature ?? '' : '')).toEqual({
      type: GROK_PACKED_REASONING_TYPE,
      items: [visible, tco(11), tco(12)],
    })
  })

  it('keeps leading opaque items in front of the visible summary', () => {
    const packed = packGrokThinkingBlocks([
      thinking('', tco(1)),
      thinking('visible think', visible),
      thinking('', tco(2)),
    ])
    expect(packed).toHaveLength(1)
    expect(JSON.parse(packed[0]?.thinkingSignature ?? '')).toEqual({
      type: GROK_PACKED_REASONING_TYPE,
      items: [tco(1), visible, tco(2)],
    })
  })

  it('keeps one empty carrier when every reasoning item is opaque', () => {
    const packed = packGrokThinkingBlocks([
      thinking('', tco(1)),
      thinking('', tco(2)),
      { type: 'text', text: 'hello' },
    ])
    expect(packed.map(block => block.type)).toEqual(['thinking', 'text'])
    expect(packed[0] && 'thinking' in packed[0] ? packed[0].thinking : undefined).toBe('')
    expect(JSON.parse(packed[0]?.thinkingSignature ?? '')).toEqual({
      type: GROK_PACKED_REASONING_TYPE,
      items: [tco(1), tco(2)],
    })
  })

  it('leaves a lone visible thinking block unchanged', () => {
    const block = thinking('visible think', visible)
    expect(packGrokThinkingBlocks([block])).toEqual([block])
  })
})

describe('expandPackedGrokReasoningInput', () => {
  it('splices packed items back into Responses input', () => {
    const payload = expandPackedGrokReasoningInput({
      model: 'grok-4.6',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: GROK_PACKED_REASONING_TYPE, items: [visible, tco(11), tco(12)] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
    })
    expect(payload).toEqual({
      model: 'grok-4.6',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        visible,
        tco(11),
        tco(12),
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
    })
  })

  it('leaves payloads without input alone', () => {
    const payload = { model: 'grok-4.6', reasoning: { effort: 'high' } }
    expect(expandPackedGrokReasoningInput(payload)).toBe(payload)
  })
})

function emptyUsage(): AssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistant(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'grok',
    model: 'grok-4.6',
    usage: emptyUsage(),
    stopReason: 'toolUse',
    timestamp: 0,
  }
}

describe('GrokThinkingFilter', () => {
  it('does not emit Think start/end for empty tco items, and packs the done message', () => {
    const filter = new GrokThinkingFilter()
    const message = assistant([
      thinking('visible think', visible),
      thinking('', tco(11)),
      thinking('', tco(12)),
      { type: 'text', text: 'hello' },
    ])
    const events: AssistantMessageEvent[] = [
      { type: 'thinking_start', contentIndex: 0, partial: message },
      { type: 'thinking_delta', contentIndex: 0, delta: 'visible think', partial: message },
      { type: 'thinking_end', contentIndex: 0, content: 'visible think', partial: message },
      { type: 'text_start', contentIndex: 1, partial: message },
      { type: 'text_delta', contentIndex: 1, delta: 'hello', partial: message },
      { type: 'text_end', contentIndex: 1, content: 'hello', partial: message },
      { type: 'thinking_start', contentIndex: 2, partial: message },
      { type: 'thinking_end', contentIndex: 2, content: '', partial: message },
      { type: 'thinking_start', contentIndex: 3, partial: message },
      { type: 'thinking_end', contentIndex: 3, content: '', partial: message },
      { type: 'done', reason: 'toolUse', message },
    ]

    const seen = events.flatMap(event => filter.take(event))
    expect(seen.map(event => event.type)).toEqual([
      'thinking_start',
      'thinking_delta',
      'thinking_end',
      'text_start',
      'text_delta',
      'text_end',
      'done',
    ])
    const done = seen.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.message.content.map(block => block.type)).toEqual(['thinking', 'text'])
    const block = done.message.content[0]
    expect(block?.type).toBe('thinking')
    if (block?.type !== 'thinking') return
    expect(JSON.parse(block.thinkingSignature ?? '')).toEqual({
      type: GROK_PACKED_REASONING_TYPE,
      items: [visible, tco(11), tco(12)],
    })
  })

  it('holds a Think row until the first non-empty delta', () => {
    const filter = new GrokThinkingFilter()
    const message = assistant([thinking('', visible)])
    expect(filter.take({ type: 'thinking_start', contentIndex: 0, partial: message })).toEqual([])
    expect(filter.take({ type: 'thinking_delta', contentIndex: 0, delta: '\n\n', partial: message })).toEqual([])
    const opened = filter.take({
      type: 'thinking_delta',
      contentIndex: 0,
      delta: 'hello',
      partial: message,
    })
    expect(opened.map(event => event.type)).toEqual(['thinking_start', 'thinking_delta'])
  })
})
