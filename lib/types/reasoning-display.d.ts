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
import type { AssistantMessageEvent, AssistantMessageEventStream } from '@earendil-works/pi-ai';
/** Tagged thinkingSignature / input item holding several Grok reasoning items. */
export declare const GROK_PACKED_REASONING_TYPE = "dsh-grok-packed-reasoning";
/** One packed replay blob stored on a visible thinking block. */
export interface GrokPackedReasoning {
    type: typeof GROK_PACKED_REASONING_TYPE;
    items: unknown[];
}
/** Whether this text should become a Think row. Whitespace-only is not visible. */
export declare function isDisplayableThinking(text: string | undefined): boolean;
/** Whether `value` is a pack this plugin wrote and must expand before send. */
export declare function isGrokPackedReasoning(value: unknown): value is GrokPackedReasoning;
/**
 * Drop empty thinking blocks from visible content and attach their signatures
 * to the first displayable thinking block (or one empty carrier if none).
 */
export declare function packGrokThinkingBlocks<T extends {
    type: string;
    thinking?: string;
    thinkingSignature?: string;
}>(content: readonly T[]): T[];
/**
 * Replace packed reasoning items in a Responses `input` with the original
 * Grok items, in the order they were packed.
 */
export declare function expandPackedGrokReasoningInput(payload: unknown): unknown;
/** Hold empty thinking_start/end off the wire and pack the final message. */
export declare class GrokThinkingFilter {
    private readonly heldStarts;
    private readonly opened;
    /** Map one upstream event to the events DSH should see. */
    take(event: AssistantMessageEvent): AssistantMessageEvent[];
    private openAnd;
}
/**
 * Forward a pi-ai Responses stream with empty Grok reasoning hidden from DSH
 * and packed onto the terminal assistant message.
 */
export declare function filterGrokThinkingStream(inner: AssistantMessageEventStream): AssistantMessageEventStream;
//# sourceMappingURL=reasoning-display.d.ts.map