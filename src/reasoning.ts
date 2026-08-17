/**
 * Official Grok reasoning wire: Responses `reasoning.effort` is the
 * models-v2 `reasoning_efforts[].value`. xAI documents
 * `low` / `medium` / `high` (default) / `xhigh`, and reasoning cannot be
 * disabled. `none`, `off`, and `summary` are not part of that request.
 */

import type { ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { GrokCatalogModel, GrokReasoningEffort } from './client-contract.ts'

/** Values the official Responses field `reasoning.effort` accepts today. */
export const GROK_REASONING_WIRES = ['low', 'medium', 'high', 'xhigh'] as const
/** Official wire value for one advertised effort. */
export type GrokReasoningWire = (typeof GROK_REASONING_WIRES)[number]
/** models-v2 `reasoning_effort` and the documented API default. */
export const GROK_DEFAULT_REASONING_WIRE: GrokReasoningWire = 'high'

const UNSUPPORTED = null

/** grok-4.6 menu from GET /v1/models-v2 (`id`/`value`/`label`). */
export const GROK_4_6_REASONING_EFFORTS: readonly GrokReasoningEffort[] = Object.freeze([
  Object.freeze({
    id: 'xhigh',
    value: 'xhigh',
    label: 'Extra High Effort',
    description: 'Highest effort and reasoning level',
  }),
  Object.freeze({
    id: 'high',
    value: 'high',
    label: 'High Effort',
    description: 'Higher implementation quality with extensive reasoning',
  }),
  Object.freeze({
    id: 'medium',
    value: 'medium',
    label: 'Medium Effort',
    description: 'Balanced effort with standard implementation and testing',
  }),
  Object.freeze({
    id: 'low',
    value: 'low',
    label: 'Low Effort',
    description: 'Quick, fast implementations',
  }),
])

/** grok-4.5 menu: same wire values minus `xhigh`. */
export const GROK_4_5_REASONING_EFFORTS: readonly GrokReasoningEffort[] = Object.freeze(
  GROK_4_6_REASONING_EFFORTS.filter(effort => effort.value !== 'xhigh'),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `value` is an official `reasoning.effort` spelling. */
export function isGrokReasoningWire(value: string): value is GrokReasoningWire {
  return (GROK_REASONING_WIRES as readonly string[]).includes(value)
}

/**
 * Official advertised efforts for one catalog row. Live models-v2 rows win;
 * otherwise the frozen per-id menu is used.
 */
export function officialEffortsFor(model: GrokCatalogModel): readonly GrokReasoningEffort[] {
  if (model.reasoningEfforts !== undefined && model.reasoningEfforts.length > 0) {
    return model.reasoningEfforts
  }
  return model.id === 'grok-4.5' ? GROK_4_5_REASONING_EFFORTS : GROK_4_6_REASONING_EFFORTS
}

/** Official default `reasoning.effort` for one catalog row. */
export function officialDefaultEffort(model: GrokCatalogModel): GrokReasoningWire {
  const values = new Set(officialEffortsFor(model).map(effort => effort.value))
  const configured = model.defaultReasoningEffort
  if (configured !== undefined && values.has(configured) && isGrokReasoningWire(configured)) {
    return configured
  }
  if (values.has(GROK_DEFAULT_REASONING_WIRE)) return GROK_DEFAULT_REASONING_WIRE
  for (const effort of officialEffortsFor(model)) {
    if (isGrokReasoningWire(effort.value)) return effort.value
  }
  return GROK_DEFAULT_REASONING_WIRE
}

/**
 * Pin every pi-ai level. Advertised official values are sent as themselves;
 * everything else, including Off, is unsupported so we never emit `none`.
 */
export function grokThinkingLevelMap(model: GrokCatalogModel): ThinkingLevelMap {
  const values = new Set(officialEffortsFor(model).map(effort => effort.value))
  return {
    off: UNSUPPORTED,
    minimal: UNSUPPORTED,
    low: values.has('low') ? 'low' : UNSUPPORTED,
    medium: values.has('medium') ? 'medium' : UNSUPPORTED,
    high: values.has('high') ? 'high' : UNSUPPORTED,
    xhigh: values.has('xhigh') ? 'xhigh' : UNSUPPORTED,
    max: UNSUPPORTED,
  }
}

/**
 * Map a selector id or already-resolved wire value onto models-v2 `value`.
 * Unknown, `none`, and `off` become the official default.
 */
export function resolveGrokReasoningWire(
  requested: unknown,
  model: GrokCatalogModel,
): GrokReasoningWire {
  const efforts = officialEffortsFor(model)
  const fallback = officialDefaultEffort(model)
  if (typeof requested !== 'string' || requested.length === 0) return fallback
  for (const effort of efforts) {
    if (effort.value === requested || effort.id === requested) {
      return isGrokReasoningWire(effort.value) ? effort.value : fallback
    }
  }
  return fallback
}

/**
 * Force the outbound Responses body onto official `reasoning: { effort }`.
 * Drops `summary` (not in the official Grok request) and never sends `none`.
 */
export function applyGrokReasoningWire(payload: unknown, model: GrokCatalogModel): unknown {
  if (!isRecord(payload) || model.thinking !== true) return payload
  const current = isRecord(payload['reasoning']) ? payload['reasoning'] : undefined
  const effort = resolveGrokReasoningWire(current?.['effort'], model)
  return { ...payload, reasoning: { effort } }
}
