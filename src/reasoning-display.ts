/**
 * Grok Responses returns many `type: reasoning` items that are not Think
 * text: encrypted replay blobs, including server-side web_search / x_search
 * outputs with `tco_*` ids and empty `summary`. pi-ai turns each one into a
 * thinking block, so the Web GUI paints a stack of empty Think rows.
 *
 * Visible thinking stays a normal block. Opaque items are packed into that
 * block's thinkingSignature and expanded back onto the next request's
 * `input` so store:false replay still sees every encrypted item, in order.
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
} from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { GrokServerSearchCallFilter } from './server-search-calls.ts'

/** Tagged thinkingSignature / input item holding several Grok reasoning items. */
export const GROK_PACKED_REASONING_TYPE = 'dsh-grok-packed-reasoning'

/** One packed replay blob stored on a visible thinking block. */
export interface GrokPackedReasoning {
  type: typeof GROK_PACKED_REASONING_TYPE
  items: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether this text should become a Think row. Whitespace-only is not visible. */
export function isDisplayableThinking(text: string | undefined): boolean {
  return (text ?? '').trim().length > 0
}

/** Whether `value` is a pack this plugin wrote and must expand before send. */
export function isGrokPackedReasoning(value: unknown): value is GrokPackedReasoning {
  if (!isRecord(value) || value['type'] !== GROK_PACKED_REASONING_TYPE) return false
  return Array.isArray(value['items'])
}

function unpackSignature(raw: string | undefined): unknown[] {
  if (raw === undefined || raw.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isGrokPackedReasoning(parsed)) return parsed.items
    return [parsed]
  } catch {
    return []
  }
}

function withPackedSignature<T extends { thinkingSignature?: string }>(
  block: T,
  items: unknown[],
): T {
  if (items.length === 0) return block
  if (items.length === 1 && !isGrokPackedReasoning(items[0])) {
    return { ...block, thinkingSignature: JSON.stringify(items[0]) }
  }
  const packed: GrokPackedReasoning = { type: GROK_PACKED_REASONING_TYPE, items }
  return { ...block, thinkingSignature: JSON.stringify(packed) }
}

/**
 * Drop empty thinking blocks from visible content and attach their signatures
 * to the first displayable thinking block (or one empty carrier if none).
 */
export function packGrokThinkingBlocks<T extends {
  type: string
  thinking?: string
  thinkingSignature?: string
}>(content: readonly T[]): T[] {
  const leading: unknown[] = []
  const out: T[] = []
  let carrierIndex = -1

  for (const block of content) {
    if (block.type !== 'thinking') {
      out.push(block)
      continue
    }
    const items = unpackSignature(block.thinkingSignature)
    if (isDisplayableThinking(block.thinking)) {
      const packed = withPackedSignature(block, [...leading, ...items])
      leading.length = 0
      carrierIndex = out.length
      out.push(packed)
      continue
    }
    leading.push(...(items.length > 0 ? items : [{ type: 'reasoning', summary: [] }]))
  }

  if (leading.length === 0) return out
  if (carrierIndex >= 0) {
    const carrier = out[carrierIndex]
    if (carrier !== undefined) {
      out[carrierIndex] = withPackedSignature(carrier, [
        ...unpackSignature(carrier.thinkingSignature),
        ...leading,
      ])
    }
    return out
  }

  const first = content.find(block => block.type === 'thinking')
  if (first === undefined) return out
  out.unshift(withPackedSignature(first, leading))
  return out
}

/**
 * Replace packed reasoning items in a Responses `input` with the original
 * Grok items, in the order they were packed.
 */
export function expandPackedGrokReasoningInput(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload['input'])) return payload
  const input: unknown[] = []
  for (const item of payload['input']) {
    if (isGrokPackedReasoning(item)) input.push(...item.items)
    else input.push(item)
  }
  return { ...payload, input }
}

/** Hold empty thinking_start/end off the wire and pack the final message. */
export class GrokThinkingFilter {
  private readonly heldStarts = new Map<number, Extract<AssistantMessageEvent, { type: 'thinking_start' }>>()
  private readonly opened = new Set<number>()

  /** Map one upstream event to the events DSH should see. */
  take(event: AssistantMessageEvent): AssistantMessageEvent[] {
    switch (event.type) {
      case 'thinking_start':
        this.heldStarts.set(event.contentIndex, event)
        return []
      case 'thinking_delta':
        if (!isDisplayableThinking(event.delta) && !this.opened.has(event.contentIndex)) {
          return []
        }
        return this.openAnd(event)
      case 'thinking_end':
        if (!isDisplayableThinking(event.content) && !this.opened.has(event.contentIndex)) {
          this.heldStarts.delete(event.contentIndex)
          return []
        }
        return this.openAnd(event)
      case 'done':
        return [{ ...event, message: packAssistant(event.message) }]
      case 'error':
        return [{ ...event, error: packAssistant(event.error) }]
      default:
        return [event]
    }
  }

  private openAnd(event: Extract<AssistantMessageEvent, { contentIndex: number }>): AssistantMessageEvent[] {
    const forwarded: AssistantMessageEvent[] = []
    const held = this.heldStarts.get(event.contentIndex)
    if (held !== undefined && !this.opened.has(event.contentIndex)) {
      forwarded.push(held)
    }
    this.heldStarts.delete(event.contentIndex)
    this.opened.add(event.contentIndex)
    forwarded.push(event)
    return forwarded
  }
}

function packAssistant(message: AssistantMessage): AssistantMessage {
  return { ...message, content: packGrokThinkingBlocks(message.content) }
}

/**
 * Forward a pi-ai Responses stream with empty Grok reasoning hidden from DSH
 * and packed onto the terminal assistant message.
 */
export function filterGrokThinkingStream(
  inner: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream()
  void pumpGrokThinkingStream(inner, out)
  return out
}

async function pumpGrokThinkingStream(
  inner: AssistantMessageEventStream,
  out: AssistantMessageEventStream,
): Promise<void> {
  const search = new GrokServerSearchCallFilter()
  const thinking = new GrokThinkingFilter()
  try {
    for await (const event of inner) {
      for (const afterSearch of search.take(event)) {
        for (const next of thinking.take(afterSearch)) out.push(next)
      }
    }
  } finally {
    out.end()
  }
}
