/** Magic-byte sniffing for generated Grok images. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
/** Detect PNG, JPEG, WebP, or GIF from a leading signature. */
export declare function mediaTypeOf(data: Uint8Array): ImageMediaType | undefined;
/** File extension that matches a sniffed raster type. */
export declare function extensionOf(mediaType: ImageMediaType): string;
//# sourceMappingURL=image-bytes.d.ts.map