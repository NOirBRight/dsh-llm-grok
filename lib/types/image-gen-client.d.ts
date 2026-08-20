/**
 * Isolated Imagine REST client. Uses the Grok subscription access token
 * against api.x.ai, matching Grok Build's ImageGenClient — not cli-chat-proxy.
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
/** Official Imagine REST base, including `/v1`. */
export declare const GROK_IMAGINE_BASE_URL = "https://api.x.ai/v1";
/** Default Imagine model used by Grok Build quality generations. */
export declare const GROK_IMAGINE_MODEL = "grok-imagine-image-quality";
/** Aspect ratios the Grok Build `image_gen` skill documents. */
export declare const GROK_IMAGINE_ASPECT_RATIOS: readonly ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "auto"];
/** One allowed `aspect_ratio` value. */
export type GrokImagineAspectRatio = (typeof GROK_IMAGINE_ASPECT_RATIOS)[number];
/** Default idle bound for one Imagine POST. First-party chat idle is five minutes; Imagine 1K bodies are slower than chat tokens. */
export declare const GROK_IMAGE_GEN_TIMEOUT_MS = 300000;
/** Extra Imagine POSTs after a dropped body / transport error. */
export declare const GROK_IMAGE_GEN_TRANSPORT_RETRIES = 1;
/** Inputs for one text-to-image call. */
export interface GenerateGrokImageRequest {
    /** Bearer access token from the Host Grok session. */
    accessToken: string;
    /** Image prompt, already trimmed. */
    prompt: string;
    /** Optional Imagine aspect ratio. */
    aspectRatio?: GrokImagineAspectRatio;
    /** Caller cancellation. */
    signal?: AbortSignal;
    /** Override `fetch` in tests. */
    fetchImpl?: typeof fetch;
    /** Override `{base}/images/generations` in tests. */
    imagesURL?: string;
    /** Override the default request timeout. */
    timeoutMs?: number;
}
/** Decoded raster from one Imagine generation. */
export interface GeneratedGrokImage {
    /** Encoded image bytes. */
    bytes: Uint8Array;
    /** Sniffed media type. */
    mediaType: ImageMediaType;
    /** Provider-revised prompt when the API returned one. */
    revisedPrompt?: string;
}
/**
 * POST Imagine `/images/generations` with a Grok session token and return raster bytes.
 * @param request - prompt, auth, and optional test overrides.
 */
export declare function generateGrokImage(request: GenerateGrokImageRequest): Promise<GeneratedGrokImage>;
//# sourceMappingURL=image-gen-client.d.ts.map