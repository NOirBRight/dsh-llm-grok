import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ModelSwitchAdapterRegistry } from 'dsh-model-switch/adapter-registry'
import { installGrokModelSwitchAdapter } from '../src/model-switch-adapter.ts'

const imageExecute = vi.hoisted(() => vi.fn())
vi.mock('../src/image-gen.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/image-gen.ts')>()
  return { ...actual, grokImageGenTool: vi.fn(() => ({ execute: imageExecute })) }
})
class AttachmentsStub extends Service { constructor(ctx: Context) { super(ctx, 'attachments') } }
class FsStub extends Service { constructor(ctx: Context) { super(ctx, 'fs') } }
class Owner extends Service { readonly adapters = new ModelSwitchAdapterRegistry(); constructor(ctx: Context) { super(ctx, 'modelSwitch') } }

describe('Grok Model Switch Image adapter', () => {
  it('registers Image only, maps aspectRatio, normalizes metadata, and disposes', async () => {
    imageExecute.mockResolvedValueOnce({ path: 'out.webp', revisedPrompt: 'better', image: { attachmentId: 'g1', mediaType: 'image/webp', bytes: 9, width: 3, height: 5, name: 'out.webp' } })
    const root = new Context(); const attachments = root.plugin(AttachmentsStub); const fs = root.plugin(FsStub); await attachments; await fs; const owner = root.plugin(Owner); await owner
    const provider = root.plugin(ctx => installGrokModelSwitchAdapter(ctx, async () => 'token')); await provider
    const entry = root.modelSwitch.adapters.get('grok')
    expect(entry).toMatchObject({ provider: 'grok', image: { provider: 'grok' } })
    expect(entry).not.toHaveProperty('search'); expect(entry).not.toHaveProperty('vision')
    expect(entry?.image?.supportsModel('grok-imagine-image-quality')).toBe(true)
    expect(entry?.image?.supportsModel('grok-chat')).toBe(false)
    const execution = { signal: new AbortController().signal } as never
    await expect(entry!.image!.generate('grok-imagine-image-quality', { prompt: 'draw', aspectRatio: '16:9', path: 'out.webp' }, execution)).resolves.toEqual({ path: 'out.webp', mediaType: 'image/webp', bytes: 9, width: 3, height: 5, attachmentId: 'g1', name: 'out.webp', revisedPrompt: 'better' })
    expect(imageExecute).toHaveBeenCalledWith({ prompt: 'draw', aspect_ratio: '16:9', path: 'out.webp' }, execution)
    await provider.dispose(); expect(root.modelSwitch.adapters.get('grok')).toBeUndefined(); await owner.dispose(); await fs.dispose(); await attachments.dispose()
  })
  it('does nothing when Model Switch is absent', async () => { const root = new Context(); const provider = root.plugin(ctx => installGrokModelSwitchAdapter(ctx, async () => 'token')); await provider; await provider.dispose() })
})
