/** Model-invoked `grok_image_gen` tool over the Grok subscription session. */

import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { extensionOf } from './image-bytes.ts'
import {
  GROK_IMAGE_GEN_TIMEOUT_MS,
  GROK_IMAGINE_ASPECT_RATIOS,
  GROK_IMAGINE_MODEL,
  generateGrokImage,
} from './image-gen-client.ts'
import type { GenerateGrokImageRequest, GrokImagineAspectRatio } from './image-gen-client.ts'

/** Public DSH tool name. Distinct from Codex `codex_generate_image`. */
export const GROK_IMAGE_GEN_TOOL_NAME = 'grok_image_gen'

/** Constructor options the plugin owns at registration time. */
export interface GrokImageGenToolOptions {
  /** Resolve the current Grok access token. Throws when unsigned-in. */
  resolveAccessToken: () => Promise<string>
  /** Override Imagine POST URL in tests. */
  imagesURL?: string
  /** Override `fetch` in tests. */
  fetchImpl?: typeof fetch
}

interface GrokImageGenValue {
  path: string
  prompt: string
  model: string
  revisedPrompt?: string
  saveWarning?: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
}

function refOf(image: GrokImageGenValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

function contentOf(value: GrokImageGenValue): ContentBlock[] {
  const lines = [
    '<path>' + value.path + '</path>',
    '<model>' + value.model + '</model>',
    '<image>' + value.image.mediaType + ', ' + String(value.image.width) + 'x' + String(value.image.height)
      + ' px, ' + String(value.image.bytes) + ' bytes</image>',
  ]
  if (value.revisedPrompt !== undefined) lines.push('<revised_prompt>' + value.revisedPrompt + '</revised_prompt>')
  if (value.saveWarning !== undefined) lines.push('<warning>' + value.saveWarning + '</warning>')
  return [
    { type: 'text', text: lines.join('\n') },
    { type: 'image', attachment: refOf(value.image) },
  ]
}

function sanitizeFilePart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '')
  return cleaned.length > 0 ? cleaned.slice(0, 48) : 'image'
}

function defaultRelativePath(prompt: string, mediaType: ImageMediaType): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').replace(/T/u, '-').replace(/Z$/u, '')
  return 'generated/grok-' + stamp + '-' + sanitizeFilePart(prompt) + '.' + extensionOf(mediaType)
}

function pathForMediaType(path: string, mediaType: ImageMediaType): string {
  const current = extname(path)
  const currentExtension = current.slice(1).toLowerCase()
  const expectedExtension = extensionOf(mediaType)
  if (currentExtension === expectedExtension || (mediaType === 'image/jpeg' && currentExtension === 'jpeg')) return path
  return (current === '' ? path : path.slice(0, -current.length)) + '.' + expectedExtension
}

async function writeGeneratedFile(
  ctx: Context,
  exec: ToolExecution,
  relativePath: string,
  bytes: Uint8Array,
): Promise<string> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(relativePath, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
  const processPath = ctx.fs.processPath(target)
  await mkdir(dirname(processPath), { recursive: true })
  await writeFile(processPath, bytes)
  const info = await ctx.fs.stat(target, exec.signal)
  if (info !== undefined) ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return target.displayPath
}

function aspectRatioOf(value: string | undefined): GrokImagineAspectRatio | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (!(GROK_IMAGINE_ASPECT_RATIOS as readonly string[]).includes(trimmed)) {
    throw new Error('grok_image_gen aspect_ratio must be one of ' + GROK_IMAGINE_ASPECT_RATIOS.join(', '))
  }
  return trimmed as GrokImagineAspectRatio
}

/** Register-ready `grok_image_gen` definition. */
export function grokImageGenTool(ctx: Context, options: GrokImageGenToolOptions): ToolDefinition {
  return defineTool({
    name: GROK_IMAGE_GEN_TOOL_NAME,
    description: 'Generate a raster image with Grok Imagine (xAI SuperGrok / Grok Build session). Uses this plugin\'s xAI login and subscription credits. Distinct from Codex `codex_generate_image`. Do not call unless the user asked for a bitmap image.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Image prompt. Be specific about subject, composition, style, text, and constraints.',
      },
      aspect_ratio: {
        type: 'string',
        enum: [...GROK_IMAGINE_ASPECT_RATIOS],
        description: 'Optional aspect ratio. Examples: 1:1, 16:9, 9:16, auto.',
      },
      path: {
        type: 'string',
        description: 'Workspace-relative destination. Defaults to generated/grok-<stamp>.<ext> under the session cwd.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
          model: { type: 'string', required: true },
          revisedPrompt: { type: 'string' },
          saveWarning: { type: 'string' },
          image: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => contentOf(value),
    },
    timeoutMs: GROK_IMAGE_GEN_TIMEOUT_MS,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (prompt.length === 0) throw new Error('grok_image_gen prompt must not be empty')
      const attachments = ctx.attachments
      const accessToken = await options.resolveAccessToken()
      const aspectRatio = aspectRatioOf(args.aspect_ratio)
      const request: GenerateGrokImageRequest = {
        accessToken,
        prompt,
        signal: exec.signal,
        ...aspectRatio === undefined ? {} : { aspectRatio },
        ...options.imagesURL === undefined ? {} : { imagesURL: options.imagesURL },
        ...options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl },
      }
      const generated = await generateGrokImage(request).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (/^terminated$/i.test(message)) {
          throw new Error('Grok Imagine connection dropped while reading the image (undici: terminated)')
        }
        throw error
      })
      if (!attachments.imageLimits.mediaTypes.includes(generated.mediaType)) {
        throw new Error(generated.mediaType + ' images are disabled by this deployment')
      }
      const relativePath = args.path === undefined || args.path.trim().length === 0
        ? defaultRelativePath(prompt, generated.mediaType)
        : pathForMediaType(args.path.trim(), generated.mediaType)
      const ref = await attachments.saveImage({
        data: generated.bytes,
        mediaType: generated.mediaType,
        name: basename(relativePath),
      })
      let path = relativePath
      let saveWarning: string | undefined
      try {
        path = await writeGeneratedFile(ctx, exec, relativePath, generated.bytes)
      } catch (error: unknown) {
        saveWarning = 'Image generation succeeded, but the image could not be saved to disk: '
          + (error instanceof Error && error.message.length > 0 ? error.message : String(error))
      }
      const value: GrokImageGenValue = {
        path,
        prompt,
        model: GROK_IMAGINE_MODEL,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
        ...generated.revisedPrompt === undefined ? {} : { revisedPrompt: generated.revisedPrompt },
        ...saveWarning === undefined ? {} : { saveWarning },
      }
      if (exec.parent !== undefined) {
        exec.deferContext(createUserMessage({
          content: contentOf(value),
          source: { kind: 'plugin', plugin: 'dsh-llm-grok' },
        }))
      }
      return value
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Grok image: ' + args.prompt,
      kind: 'other',
      rawInput: args.prompt,
      ...args.path === undefined || args.path.trim().length === 0
        ? {}
        : { locations: [{ path: args.path }] },
    }),
  })
}
