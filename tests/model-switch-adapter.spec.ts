import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ModelSwitchAdapterRegistry } from 'dsh-model-switch/adapter-registry'
import { installGrokModelSwitchAdapters } from '../src/model-switch-adapter.ts'
import type { GrokOAuthRuntime } from '../src/oauth.ts'

class Owner extends Service { readonly adapters = new ModelSwitchAdapterRegistry(); constructor(ctx: Context) { super(ctx, 'modelSwitch') } }

describe('Grok Model Switch adapters', () => {
  it('registers authenticated Vision and Imagine, then disposes', async () => {
    const root = new Context(); const owner = root.plugin(Owner)
    const provider = root.plugin(ctx => installGrokModelSwitchAdapters(ctx, {} as GrokOAuthRuntime))
    await Promise.resolve(provider)
    expect(root.modelSwitch.adapters.get('grok')).toMatchObject({ provider: 'grok', vision: { provider: 'grok' }, image: { provider: 'grok' } })
    expect(root.modelSwitch.adapters.get('grok')?.search).toBeUndefined()
    await provider.dispose(); expect(root.modelSwitch.adapters.get('grok')).toBeUndefined()
    await owner.dispose()
  })
})
