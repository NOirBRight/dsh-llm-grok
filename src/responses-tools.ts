/**
 * Inject xAI server-side search tools into an outbound Responses body.
 * Pi-ai only emits `{ type: "function" }` tools; the proxy runs web_search
 * and x_search itself. Search results come back as encrypted `type: reasoning`
 * items (`tco_*`) with empty summaries — packed off the Think UI, replayed
 * on the next request. This is not a `ctx.web` provider.
 */

import type {
  Api,
  AssistantMessageEventStream,
  Context as PiContext,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  StreamOptions,
} from '@earendil-works/pi-ai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { GrokCatalogModel } from './client-contract.ts'
import { applyGrokReasoningWire } from './reasoning.ts'
import {
  expandPackedGrokReasoningInput,
  filterGrokThinkingStream,
} from './reasoning-display.ts'

/** Server-side search tools the Grok CLI chat proxy accepts on every request. */
export const GROK_SERVER_SEARCH_TOOLS = [
  { type: 'web_search' },
  { type: 'x_search' },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolType(tool: unknown): string | undefined {
  if (!isRecord(tool)) return undefined
  return typeof tool['type'] === 'string' ? tool['type'] : undefined
}

function toolName(tool: unknown): string | undefined {
  if (!isRecord(tool)) return undefined
  return typeof tool['name'] === 'string' ? tool['name'] : undefined
}

function occupiesServerTool(tool: unknown, type: string): boolean {
  return toolType(tool) === type || toolName(tool) === type
}

/**
 * Append `{ type: "web_search" }` and `{ type: "x_search" }` when missing.
 * Leaves non-object payloads unchanged.
 * @param payload - the Responses `create` body pi-ai is about to send.
 */
export function injectGrokServerSearchTools(payload: unknown): unknown {
  if (!isRecord(payload)) return payload
  const existing = payload['tools']
  const tools = Array.isArray(existing) ? [...existing] : []
  for (const extra of GROK_SERVER_SEARCH_TOOLS) {
    if (!tools.some(tool => occupiesServerTool(tool, extra.type))) tools.push({ type: extra.type })
  }
  return { ...payload, tools }
}

function catalogFor(model: Model<Api>, models: readonly GrokCatalogModel[]): GrokCatalogModel {
  return models.find(entry => entry.id === model.id) ?? {
    id: model.id,
    thinking: model.reasoning,
  }
}

interface PiToolSpec {
  name: string
  description?: string
  parameters?: unknown
}

interface PiMessage {
  role: string
  content?: unknown
  toolsAdded?: PiToolSpec[]
  toolsRemoved?: Array<{ name: string }>
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => (isRecord(block) && typeof block['text'] === 'string' ? block['text'] : ''))
    .filter(text => text.length > 0)
    .join('\n\n')
}

function piToolsOf(tools: unknown): PiToolSpec[] {
  if (!Array.isArray(tools)) return []
  const out: PiToolSpec[] = []
  for (const tool of tools) {
    if (isRecord(tool) && typeof tool['name'] === 'string') out.push(tool as unknown as PiToolSpec)
  }
  return out
}

/**
 * Fold pi `system` messages into `context.systemPrompt` before pi-ai 0.85.x
 * sees them.
 *
 * Newer `dsh-llm-pi-ai` seams deliver the harness system prompt (and developer
 * tool declarations) as `role: "system"` messages whose `content` may be a
 * plain string. pi-ai 0.85.x both crashes estimating such messages
 * (`estimateMessageTokens` iterates non-user content as a block array and
 * reads `block.name.length` off a string character) and silently drops any
 * role it does not convert on the wire. Lifting them into the supported
 * `systemPrompt` field fixes the estimation crash *and* restores the prompt
 * and tool declarations on the wire. Tool updates merge into `context.tools`
 * (deduplicated by name; removed names dropped), the only tool channel pi-ai
 * 0.85.x understands. Fixed upstream in pi-ai 1.3.0 (`role === "system"`
 * branch); this is the plugin-owned backport for the `^0.85.1` line.
 */
export function liftSystemMessages(context: PiContext): PiContext {
  const messages = context.messages as unknown as PiMessage[] | undefined
  if (messages === undefined || !messages.some(message => message.role === 'system')) return context
  const texts: string[] = []
  const tools = Array.isArray(context.tools) ? [...piToolsOf(context.tools)] : []
  const names = new Set(tools.map(tool => tool.name))
  const kept: PiMessage[] = []
  for (const message of messages) {
    if (message.role !== 'system') {
      kept.push(message)
      continue
    }
    texts.push(textOfContent(message.content))
    for (const tool of piToolsOf(message.toolsAdded)) {
      if (!names.has(tool.name)) {
        names.add(tool.name)
        tools.push(tool)
      }
    }
    const removed = new Set(piToolsOf(message.toolsRemoved).map(tool => tool.name))
    if (removed.size > 0) {
      for (let index = tools.length - 1; index >= 0; index -= 1) {
        if (removed.has(tools[index]!.name)) tools.splice(index, 1)
      }
      names.clear()
      for (const tool of tools) names.add(tool.name)
    }
  }
  const prompt = [context.systemPrompt, ...texts].filter(text => text !== undefined && text.length > 0).join('\n\n')
  const next = {
    ...context,
    messages: kept as never,
  } as PiContext & Record<string, unknown>
  if (prompt.length > 0) next.systemPrompt = prompt
  else delete next.systemPrompt
  if (tools.length > 0) next.tools = tools as never
  else delete next.tools
  return next as PiContext
}

/** Apply every Grok context transform ahead of the pi-ai 0.85.x stream. */

function withGrokResponsesBody<TOptions extends StreamOptions>(
  streamFn: (model: Model<Api>, context: PiContext, options?: TOptions) => AssistantMessageEventStream,
  models: readonly GrokCatalogModel[],
): (model: Model<Api>, context: PiContext, options?: TOptions) => AssistantMessageEventStream {
  return (model, context, options) => {
    const original = options?.onPayload
    return streamFn(model, context, {
      ...options,
      onPayload: async (payload, nextModel) => {
        const next = original === undefined ? payload : await original(payload, nextModel)
        const injected = injectGrokServerSearchTools(next === undefined ? payload : next)
        const wired = applyGrokReasoningWire(injected, catalogFor(nextModel, models))
        return expandPackedGrokReasoningInput(wired)
      },
    } as TOptions)
  }
}

/**
 * OpenAI Responses streams with Grok server-side search tools and official
 * `reasoning.effort` patched in. Wrapping `onPayload` is required because
 * pi-ai's client has no custom fetch.
 */
function withHiddenOpaqueThinking<TOptions extends StreamOptions>(
  streamFn: (model: Model<Api>, context: PiContext, options?: TOptions) => AssistantMessageEventStream,
): (model: Model<Api>, context: PiContext, options?: TOptions) => AssistantMessageEventStream {
  return (model, context, options) => filterGrokThinkingStream(streamFn(model, context, options))
}

export function grokResponsesApi(models: readonly GrokCatalogModel[] = []): ProviderStreams {
  const base = openAIResponsesApi()
  const withGrokContext = <TOptions extends StreamOptions>(
    streamFn: (model: Model<Api>, context: PiContext, options?: TOptions) => AssistantMessageEventStream,
  ): ((model: Model<Api>, context: PiContext, options?: TOptions) => AssistantMessageEventStream) =>
    (model, context, options) => streamFn(model, liftSystemMessages(context), options)
  return {
    stream: withHiddenOpaqueThinking(withGrokContext(withGrokResponsesBody<StreamOptions>(base.stream, models))),
    streamSimple: withHiddenOpaqueThinking(
      withGrokContext(withGrokResponsesBody<SimpleStreamOptions>(base.streamSimple, models)),
    ),
  }
}
