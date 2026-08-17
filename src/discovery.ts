/**
 * Account model catalog from cli-chat-proxy GET /v1/models-v2.
 */

import { GROK_CATALOG } from './client-contract.ts'
import type { GrokCatalogModel, GrokReasoningEffort } from './client-contract.ts'
import { GROK_CLI_REQUEST_HEADERS } from './cli-identity.ts'

/** Production models URL. */
export const GROK_MODELS_URL = 'https://cli-chat-proxy.grok.com/v1/models-v2'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asEffort(value: unknown): GrokReasoningEffort | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const wire = value['value']
  const label = value['label']
  const description = value['description']
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (typeof wire !== 'string' || wire.length === 0) return undefined
  return {
    id,
    value: wire,
    ...typeof label === 'string' && label.length > 0 ? { label } : {},
    ...typeof description === 'string' && description.length > 0 ? { description } : {},
  }
}

function asEfforts(value: unknown): GrokReasoningEffort[] | undefined {
  if (!Array.isArray(value)) return undefined
  const efforts: GrokReasoningEffort[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const effort = asEffort(entry)
    if (effort === undefined || seen.has(effort.value)) continue
    seen.add(effort.value)
    efforts.push(effort)
  }
  return efforts.length > 0 ? efforts : undefined
}

function asModel(value: unknown): GrokCatalogModel | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  if (typeof id !== 'string' || id.length === 0) return undefined
  const name = value['name']
  const thinking = value['supports_reasoning_effort'] === true
    || value['thinking'] === true
  const defaultReasoningEffort = value['reasoning_effort']
  const reasoningEfforts = asEfforts(value['reasoning_efforts'])
  const contextWindow = value['context_window'] ?? value['contextWindow']
  return {
    id,
    ...typeof name === 'string' && name.length > 0 ? { name } : {},
    thinking,
    vision: true,
    ...typeof contextWindow === 'number' && Number.isInteger(contextWindow) && contextWindow > 0
      ? { contextWindow }
      : {},
    ...thinking && typeof defaultReasoningEffort === 'string' && defaultReasoningEffort.length > 0
      ? { defaultReasoningEffort }
      : {},
    ...thinking && reasoningEfforts !== undefined ? { reasoningEfforts } : {},
  }
}

/**
 * Parse a models-v2 (or /v1/models) list body.
 * @param value - JSON body.
 */
export function parseGrokModels(value: unknown): GrokCatalogModel[] | undefined {
  if (!isRecord(value) || !Array.isArray(value['data'])) return undefined
  const models: GrokCatalogModel[] = []
  const seen = new Set<string>()
  for (const entry of value['data']) {
    const model = asModel(entry)
    if (model === undefined || seen.has(model.id)) continue
    seen.add(model.id)
    models.push(model)
  }
  return models.length > 0 ? models : undefined
}

/** One Host catalog read. */
export interface GrokModelsRequest {
  accessToken: string
  modelsURL?: string
  fetch?: typeof fetch
  signal?: AbortSignal
}

/**
 * Read the signed-in account catalog. Failures return undefined so callers
 * can keep the last good / frozen list.
 */
export async function readGrokModels(request: GrokModelsRequest): Promise<GrokCatalogModel[] | undefined> {
  const url = request.modelsURL ?? GROK_MODELS_URL
  const fetchImpl = request.fetch ?? fetch
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${request.accessToken}`,
        ...GROK_CLI_REQUEST_HEADERS,
      },
      redirect: 'error',
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    return parseGrokModels(await response.json())
  } catch {
    return undefined
  }
}

/** Frozen fallback used when discovery has not succeeded. */
export function fallbackGrokCatalog(): GrokCatalogModel[] {
  return GROK_CATALOG.map(model => ({ ...model }))
}
