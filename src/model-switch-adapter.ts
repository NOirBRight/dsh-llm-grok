import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ModelSwitchAdapterRegistry, ModelSwitchGeneratedImage, ModelSwitchProviderAdapters } from 'dsh-model-switch/adapter-registry'
import { GROK_IMAGINE_MODEL } from './image-gen-client.ts'
import { grokImageGenTool } from './image-gen.ts'

type GeneratedValue = { path: string; revisedPrompt?: string; image: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number; name?: string } }
function generatedValue(value: unknown): GeneratedValue {
  if (typeof value !== 'object' || value === null) throw new Error('Grok image adapter returned no metadata')
  const result = value as Partial<GeneratedValue>
  if (typeof result.path !== 'string' || typeof result.image !== 'object' || result.image === null) throw new Error('Grok image adapter returned invalid metadata')
  const image = result.image as Partial<GeneratedValue['image']>
  if (typeof image.attachmentId !== 'string' || typeof image.mediaType !== 'string' || typeof image.bytes !== 'number' || typeof image.width !== 'number' || typeof image.height !== 'number') throw new Error('Grok image adapter returned invalid image metadata')
  return result as GeneratedValue
}
function normalize(value: GeneratedValue): ModelSwitchGeneratedImage {
  return { path: value.path, mediaType: value.image.mediaType, width: value.image.width, height: value.image.height, bytes: value.image.bytes, attachmentId: value.image.attachmentId, ...(value.image.name === undefined ? {} : { name: value.image.name }), ...(value.revisedPrompt === undefined ? {} : { revisedPrompt: value.revisedPrompt }) }
}
declare module '@deepseek-ai/cordis' { interface Context { modelSwitch: { readonly adapters: ModelSwitchAdapterRegistry } } }

/** Optional Image-only integration; no Search/Vision registration or standalone behavior changes. */
export function installGrokModelSwitchAdapter(ctx: Context, resolveAccessToken: () => Promise<string>): void {
  let imageContext: Context | undefined
  ctx.inject(['attachments', 'fs'], scope => { imageContext = scope; return () => { if (imageContext === scope) imageContext = undefined } })
  const adapters: ModelSwitchProviderAdapters = {
    provider: 'grok',
    image: {
      provider: 'grok',
      supportsModel: model => imageContext !== undefined && model === GROK_IMAGINE_MODEL,
      async generate(_model, request, execution) {
        if (typeof execution !== 'object' || execution === null) throw new Error('image adapter requires public ToolRunContext')
        const toolExecution = execution as ToolRunContext
        if (imageContext === undefined) throw new Error('Grok image adapter requires attachments and fs')
        const tool = grokImageGenTool(imageContext, { resolveAccessToken })
        const args = { prompt: request.prompt, ...(request.path === undefined ? {} : { path: request.path }), ...(request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio }) }
        return normalize(generatedValue(await tool.execute(args, toolExecution)))
      },
    },
  }
  ctx.inject(['modelSwitch'], scope => scope.effect(() => scope.modelSwitch.adapters.register(adapters), 'Model Switch: register Grok Image adapter'))
}
