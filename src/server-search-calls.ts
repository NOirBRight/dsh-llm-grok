/**
 * Grok's always-on `web_search` / `x_search` run on the proxy. Results
 * come back as encrypted `tco_*` reasoning. Grok also sometimes echoes the
 * same search as a client `custom_tool_call` whose call_id is `xs_call-*`
 * / `ws_call-*` and whose name is copied from the DSH prompt
 * (`x_keyword_search`, `x_semantic_search`, …).
 *
 * Those names are not DSH top-level tools (Code mode only exposes
 * `run_code`). If they reach the agent loop they paint
 * `unknown tool "x_keyword_search"`. Drop them from the DSH-visible
 * stream; search already ran server-side.
 */

import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'

/** Grok server-search call_id prefixes observed on cli-chat-proxy. */
const GROK_SERVER_SEARCH_CALL_PREFIXES = ['xs_call-', 'ws_call-', 'web_search_call-'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True when this tool-call id is a Grok server search echo, not a DSH
 * function. The id is `call_id|item_id`; only the call_id prefix matters.
 */
export function isGrokServerSearchToolCallId(id: string | undefined): boolean {
  if (id === undefined || id.length === 0) return false
  const callId = id.split('|')[0] ?? id
  return GROK_SERVER_SEARCH_CALL_PREFIXES.some(prefix => callId.startsWith(prefix))
}

function toolCallFromEvent(
  event: AssistantMessageEvent,
): { id: string, name: string } | undefined {
  if (event.type === 'toolcall_end') {
    return { id: event.toolCall.id, name: event.toolCall.name }
  }
  if (event.type !== 'toolcall_start' && event.type !== 'toolcall_delta') return undefined
  const block = event.partial.content[event.contentIndex]
  if (!isRecord(block) || block['type'] !== 'toolCall') return undefined
  const id = typeof block['id'] === 'string' ? block['id'] : undefined
  const name = typeof block['name'] === 'string' ? block['name'] : undefined
  if (id === undefined || name === undefined) return undefined
  return { id, name }
}

/** Strip server-search echoes and relax `toolUse` when nothing else remains. */
export function stripGrokServerSearchToolCalls(message: AssistantMessage): AssistantMessage {
  const content = message.content.filter(
    block => !(block.type === 'toolCall' && isGrokServerSearchToolCallId(block.id)),
  )
  if (content.length === message.content.length) return message
  const stillCalling = content.some(block => block.type === 'toolCall')
  const stopReason = message.stopReason === 'toolUse' && !stillCalling ? 'stop' : message.stopReason
  return { ...message, content, stopReason }
}

/** Hold server-search toolcall_* events off the DSH stream. */
export class GrokServerSearchCallFilter {
  private readonly hidden = new Set<number>()

  /** Map one upstream event to the events DSH should see. */
  take(event: AssistantMessageEvent): AssistantMessageEvent[] {
    switch (event.type) {
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end': {
        if (this.hidden.has(event.contentIndex)) return []
        const call = toolCallFromEvent(event)
        if (call !== undefined && isGrokServerSearchToolCallId(call.id)) {
          this.hidden.add(event.contentIndex)
          return []
        }
        return [event]
      }
      case 'done': {
        const message = stripGrokServerSearchToolCalls(event.message)
        const reason = message.stopReason === 'stop' || message.stopReason === 'length'
          || message.stopReason === 'toolUse'
          ? message.stopReason
          : event.reason
        return [{ ...event, message, reason }]
      }
      case 'error':
        return [{ ...event, error: stripGrokServerSearchToolCalls(event.error) }]
      default:
        return [event]
    }
  }
}
