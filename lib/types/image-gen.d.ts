/** Model-invoked `grok_image_gen` tool over the Grok subscription session. */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/** Public DSH tool name. Distinct from Codex `codex_generate_image`. */
export declare const GROK_IMAGE_GEN_TOOL_NAME = "grok_image_gen";
/** Constructor options the plugin owns at registration time. */
export interface GrokImageGenToolOptions {
    /** Resolve the current Grok access token. Throws when unsigned-in. */
    resolveAccessToken: () => Promise<string>;
    /** Override Imagine POST URL in tests. */
    imagesURL?: string;
    /** Override `fetch` in tests. */
    fetchImpl?: typeof fetch;
}
/** Register-ready `grok_image_gen` definition. */
export declare function grokImageGenTool(ctx: Context, options: GrokImageGenToolOptions): ToolDefinition;
//# sourceMappingURL=image-gen.d.ts.map