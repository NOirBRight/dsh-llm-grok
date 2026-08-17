/**
 * Official Grok reasoning wire: Responses `reasoning.effort` is the
 * models-v2 `reasoning_efforts[].value`. xAI documents
 * `low` / `medium` / `high` (default) / `xhigh`, and reasoning cannot be
 * disabled. `none`, `off`, and `summary` are not part of that request.
 */
import type { ThinkingLevelMap } from '@earendil-works/pi-ai';
import type { GrokCatalogModel, GrokReasoningEffort } from './client-contract.ts';
/** Values the official Responses field `reasoning.effort` accepts today. */
export declare const GROK_REASONING_WIRES: readonly ["low", "medium", "high", "xhigh"];
/** Official wire value for one advertised effort. */
export type GrokReasoningWire = (typeof GROK_REASONING_WIRES)[number];
/** models-v2 `reasoning_effort` and the documented API default. */
export declare const GROK_DEFAULT_REASONING_WIRE: GrokReasoningWire;
/** grok-4.6 menu from GET /v1/models-v2 (`id`/`value`/`label`). */
export declare const GROK_4_6_REASONING_EFFORTS: readonly GrokReasoningEffort[];
/** grok-4.5 menu: same wire values minus `xhigh`. */
export declare const GROK_4_5_REASONING_EFFORTS: readonly GrokReasoningEffort[];
/** Whether `value` is an official `reasoning.effort` spelling. */
export declare function isGrokReasoningWire(value: string): value is GrokReasoningWire;
/**
 * Official advertised efforts for one catalog row. Live models-v2 rows win;
 * otherwise the frozen per-id menu is used.
 */
export declare function officialEffortsFor(model: GrokCatalogModel): readonly GrokReasoningEffort[];
/** Official default `reasoning.effort` for one catalog row. */
export declare function officialDefaultEffort(model: GrokCatalogModel): GrokReasoningWire;
/**
 * Pin every pi-ai level. Advertised official values are sent as themselves;
 * everything else, including Off, is unsupported so we never emit `none`.
 */
export declare function grokThinkingLevelMap(model: GrokCatalogModel): ThinkingLevelMap;
/**
 * Map a selector id or already-resolved wire value onto models-v2 `value`.
 * Unknown, `none`, and `off` become the official default.
 */
export declare function resolveGrokReasoningWire(requested: unknown, model: GrokCatalogModel): GrokReasoningWire;
/**
 * Force the outbound Responses body onto official `reasoning: { effort }`.
 * Drops `summary` (not in the official Grok request) and never sends `none`.
 */
export declare function applyGrokReasoningWire(payload: unknown, model: GrokCatalogModel): unknown;
//# sourceMappingURL=reasoning.d.ts.map