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
  return {
    stream: withHiddenOpaqueThinking(withGrokResponsesBody<StreamOptions>(base.stream, models)),
    streamSimple: withHiddenOpaqueThinking(
      withGrokResponsesBody<SimpleStreamOptions>(base.streamSimple, models),
    ),
  }
}
