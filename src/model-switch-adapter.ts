import type { Context } from '@deepseek-ai/cordis'
import type { ModelSwitchAdapterRegistry, ModelSwitchGeneratedImage, ModelSwitchProviderAdapters } from 'dsh-model-switch/adapter-registry'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { GROK_IMAGINE_MODEL } from './image-gen-client.ts'
import { grokImageGenTool } from './image-gen.ts'
import type { GrokOAuthRuntime } from './oauth.ts'
import { resolveGrokAccessToken } from './adapter.ts'

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
/** Optional Image-only integration using the installed Model Switch registry contract. */
export function installGrokModelSwitchAdapters(ctx: Context, runtime: GrokOAuthRuntime): void {
  let imageContext: Context | undefined
  ctx.inject(['attachments', 'fs'], scope => { imageContext = scope; return () => { if (imageContext === scope) imageContext = undefined } })
  const adapters: ModelSwitchProviderAdapters = { provider: 'grok', image: { provider: 'grok', supportsModel: model => imageContext !== undefined && model === GROK_IMAGINE_MODEL, async generate(_model, request, execution) {
    if (typeof execution !== 'object' || execution === null) throw new Error('image adapter requires public ToolRunContext')
    if (imageContext === undefined) throw new Error('Grok image adapter requires attachments and fs')
    const tool = grokImageGenTool(imageContext, { resolveAccessToken: () => resolveGrokAccessToken(runtime) })
    const args = { prompt: request.prompt, ...(request.path === undefined ? {} : { path: request.path }), ...(request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio }) }
    return normalize(generatedValue(await tool.execute(args, execution as ToolRunContext)))
  } } }
  ctx.inject(['modelSwitch'], scope => { const owner = scope.get('modelSwitch') as { adapters: ModelSwitchAdapterRegistry } | undefined; if (owner === undefined) return; scope.effect(() => owner.adapters.register(adapters), 'Model Switch: register Grok Image adapter') })
}
