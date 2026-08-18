// @vitest-environment jsdom

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/client-contract.ts'
import type { GrokSettingsView } from '../src/client-contract.ts'
import { apply, inject } from '../src/client/index.ts'

const value: GrokSettingsView = {
  streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  models: GROK_CATALOG.map(model => ({ ...model })),
}

function scope(): SettingsScope<GrokSettingsView> {
  const snapshot: SettingsScopeSnapshot<GrokSettingsView> = {
    status: 'ready',
    value,
    base: value,
    user: {},
    revision: 1,
    writable: true,
    mode: 'host',
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    set: vi.fn(() => Promise.resolve()),
    unset: vi.fn(() => Promise.resolve()),
  }
}

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
  ctx.provide('settingsScope', { bind: () => scope() } as never)
  ctx.provide('connection', {
    rpc: {
      call: async () => ({ ok: true, value: { loggedIn: false } }),
    },
  } as never)
  return { ctx, slots }
}

describe('Grok client plugin registration', () => {
  it('declares only the client services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'settingsScope'])
  })

  it('reads usage through the grok usage/read RPC without exposing tokens', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', {
      register: () => () => undefined,
      bind: () => (key: string) => key,
    } as never)
    const calls: Array<{ channel: string, endpoint: string, payload: unknown }> = []
    ctx.provide('settingsScope', { bind: () => scope() } as never)
    ctx.provide('connection', {
      rpc: {
        call: async (channel: string, endpoint: string, payload: unknown) => {
          calls.push({ channel, endpoint, payload })
          return {
            ok: true,
            value: {
              status: 'ok',
              usage: {
                fetchedAt: '2026-08-17T00:00:00.000Z',
                windows: [{ id: 'monthly', used: 1, limit: 10 }],
              },
            },
          }
        },
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const face = (slots.entries('settings.provider.item')[0] as {
      inject?: () => { fetchUsage: () => Promise<unknown> }
    }).inject?.()
    const usage = await face?.fetchUsage()
    expect(calls).toEqual([{ channel: '/grok', endpoint: 'usage/read', payload: {} }])
    expect(usage).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-08-17T00:00:00.000Z',
        windows: [{ id: 'monthly', used: 1, limit: 10 }],
      },
    })
    expect(JSON.stringify(usage)).not.toMatch(/accessToken|refreshToken|Bearer/u)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('registers the card, then removes it with the plugin fiber', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(slots.entries('settings.section').map(e => e.options.id)).toEqual(['providers'])
    const entries = slots.entries('settings.provider.item')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ key: 'llm-grok', locale: 'settings.grok' })
    const face = (entries[0] as { inject?: () => unknown }).inject?.() as { t: (key: string) => string }
    expect(typeof face.t).toBe('function')
    expect(slots.entries('shell.overlay')).toHaveLength(1)
    expect(slots.entries('shell.overlay')[0]?.options).toMatchObject({ id: 'grok-model-picker' })

    await fiber.dispose()

    expect(slots.entries('settings.provider.item')).toHaveLength(0)
    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
