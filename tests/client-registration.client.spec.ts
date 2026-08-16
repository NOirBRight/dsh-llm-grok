// @vitest-environment jsdom

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

interface SlotEntry {
  options: Record<string, unknown>
  inject?: () => unknown
}

class FakeSlots extends Service {
  private readonly registered: SlotEntry[] = []

  constructor(ctx: Context) { super(ctx, 'slots') }

  inject(_name: string, register: () => () => void): void { this.ctx.effect(register) }

  register(options: Record<string, unknown> & { inject?: () => unknown }, _component: unknown): () => void {
    const entry = { options, inject: options.inject }
    this.registered.push(entry)
    return () => { this.registered.splice(this.registered.indexOf(entry), 1) }
  }

  entries(name: string): readonly SlotEntry[] {
    return this.registered.filter(entry => entry.options['name'] === name)
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(FakeSlots).await()
  const slots = ctx.get('slots') as FakeSlots
  ctx.provide('locale', {
    register: () => () => undefined,
    bind: () => (key: string) => key,
  } as never)
  return { ctx, slots }
}

describe('Grok client plugin registration', () => {
  it('declares only the client services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the card, then removes it with the plugin fiber', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entries = slots.entries('settings.plugin.item')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'grok', order: 40, locale: 'settings.grok' })
    const face = (entries[0] as { inject?: () => unknown }).inject?.() as { t: (key: string) => string }
    expect(typeof face.t).toBe('function')
    expect(slots.entries('shell.overlay')).toHaveLength(0)

    await fiber.dispose()

    expect(slots.entries('settings.plugin.item')).toHaveLength(0)
  })
})
