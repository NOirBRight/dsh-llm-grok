import { Context, Service } from '@deepseek-ai/cordis'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { describe, expect, it, vi } from 'vitest'
import { ModelSwitchAdapterRegistry } from 'dsh-model-switch/adapter-registry'
import { GrokSearchProvider } from '../src/search.ts'
import { installGrokModelSwitchAdapters } from '../src/model-switch-adapter.ts'
const imageExecute = vi.hoisted(() => vi.fn())
vi.mock('../src/image-gen.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/image-gen.ts')>(), grokImageGenTool: vi.fn(() => ({ execute: imageExecute })) }))
class AttachmentsStub extends Service { constructor(ctx: Context) { super(ctx, 'attachments') } }
class FsStub extends Service { constructor(ctx: Context) { super(ctx, 'fs') } }
class Owner extends Service { readonly adapters = new ModelSwitchAdapterRegistry(); constructor(ctx: Context) { super(ctx, 'modelSwitch') } }
describe('Grok Model Switch Search/Image adapters', () => {
  it('registers search with label/models and image, delegates, and disposes', async () => {
    const result: WebSearchResult = { content: 'answer', sources: [{ url: 'https://example.com/a' }], truncated: false }
    const search = vi.spyOn(GrokSearchProvider.prototype, 'search').mockResolvedValue(result)
    imageExecute.mockResolvedValueOnce({ path: 'out.webp', revisedPrompt: 'better', image: { attachmentId: 'g1', mediaType: 'image/webp', bytes: 9, width: 3, height: 5, name: 'out.webp' } })
    const root = new Context(); const attachments = root.plugin(AttachmentsStub); const fs = root.plugin(FsStub); await attachments; await fs; const owner = root.plugin(Owner); await owner
    const provider = root.plugin(ctx => installGrokModelSwitchAdapters(ctx, {} as never)); await provider
    const entry = root.modelSwitch.adapters.get('grok')
    expect(entry).toMatchObject({ provider: 'grok', search: { provider: 'grok' }, image: { provider: 'grok' } })
    expect(entry).not.toHaveProperty('vision')
    const meta = entry?.search as unknown as { label?: string, models?: readonly { id: string, name: string }[] }
    expect(meta.label).toBe('Grok')
    expect(meta.models).toEqual([{ id: 'grok-4.6', name: 'Grok 4.6' }, { id: 'grok-4.5', name: 'Grok 4.5' }])
    expect(entry?.search?.supportsModel('grok-4.6')).toBe(true)
    expect(entry?.search?.supportsModel('grok-4.5')).toBe(true)
    expect(entry?.search?.supportsModel('grok-imagine-image-quality')).toBe(false)
    const request: WebSearchRequest = { query: 'thin proxy', maxResults: 2 }; const signal = new AbortController().signal
    await expect(entry!.search!.search('grok-4.6', request, signal)).resolves.toBe(result)
    expect(search).toHaveBeenCalledWith(request, signal)
    await expect(entry!.search!.search('grok-imagine-image-quality', request, signal)).rejects.toThrow(/unsupported Grok search model/)
    expect(entry?.image?.supportsModel('grok-imagine-image-quality')).toBe(true); expect(entry?.image?.supportsModel('grok-chat')).toBe(false)
    const execution = { signal: new AbortController().signal } as never
    await expect(entry!.image!.generate('grok-imagine-image-quality', { prompt: 'draw', aspectRatio: '16:9', path: 'out.webp' }, execution)).resolves.toEqual({ path: 'out.webp', mediaType: 'image/webp', bytes: 9, width: 3, height: 5, attachmentId: 'g1', name: 'out.webp', revisedPrompt: 'better' })
    expect(imageExecute).toHaveBeenCalledWith({ prompt: 'draw', aspect_ratio: '16:9', path: 'out.webp' }, execution)
    await provider.dispose(); expect(root.modelSwitch.adapters.get('grok')).toBeUndefined(); await owner.dispose(); await fs.dispose(); await attachments.dispose(); search.mockRestore()
  })
  it('does nothing when Model Switch is absent', async () => { const root = new Context(); const provider = root.plugin(ctx => installGrokModelSwitchAdapters(ctx, {} as never)); await provider; await provider.dispose() })
})
