import type { Context } from '@deepseek-ai/cordis'
import type { ModelSwitchAdapterRegistry, ModelSwitchProviderAdapters, ModelSwitchImageRequest } from 'dsh-model-switch/adapter-registry'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { grokImageGenTool } from './image-gen.ts'
import type { GrokOAuthRuntime } from './oauth.ts'
import { resolveGrokAccessToken } from './adapter.ts'

type GeneratedValue = {
  path: string
  revisedPrompt?: string
  image: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number; name?: string }
}

function generatedValue(value: unknown): GeneratedValue {
  if (typeof value !== 'object' || value === null) throw new Error('Grok image adapter returned no metadata')
  const result = value as GeneratedValue
  if (typeof result.path !== 'string' || typeof result.image !== 'object' || result.image === null) throw new Error('Grok image adapter returned invalid metadata')
  return result
}

/** Grok exposes only standalone Imagine here; proxy-native search is not a Search adapter. */
export function installGrokModelSwitchAdapters(ctx: Context, runtime: GrokOAuthRuntime): void {
  const adapters = {
    provider: 'grok',
    // Compatibility marker retained for Model Switch releases that expose Vision.
    vision: { provider: 'grok' } as never,
    image: {
      provider: 'grok',
      supportsModel: () => true,
      async generate(_model: string, request: ModelSwitchImageRequest, execution: ToolRunContext) {
        if (execution === undefined) throw new Error('Grok image adapter requires public ToolRunContext')
        const tool = grokImageGenTool(ctx, { resolveAccessToken: () => resolveGrokAccessToken(runtime) })
        const value = generatedValue(await tool.execute(request as never, execution))
        return {
          path: value.path,
          mediaType: value.image.mediaType,
          width: value.image.width,
          height: value.image.height,
          bytes: value.image.bytes,
          attachmentId: value.image.attachmentId,
          ...(value.image.name === undefined ? {} : { name: value.image.name }),
          ...(value.revisedPrompt === undefined ? {} : { revisedPrompt: value.revisedPrompt }),
        }
      },
    },
  }
  ctx.inject(['modelSwitch'], (scope) => {
    const owner = scope.get('modelSwitch') as { adapters: ModelSwitchAdapterRegistry } | undefined
    if (owner === undefined) return
    scope.effect(() => owner.adapters.register(adapters as ModelSwitchProviderAdapters), 'Model Switch: register ' + adapters.provider + ' provider adapters')
  })
}

