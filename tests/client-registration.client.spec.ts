// @vitest-environment jsdom

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/client-contract.ts'
import type { GrokSettingsView } from '../src/client-contract.ts'
import { apply, inject } from '../src/client/index.ts'
import { clearProviderUsageCache, peekCachedUsage, rememberHeadlineQuota } from 'dsh-llm-providers-ui/usage-readers'

const value: GrokSettingsView = {
  streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  models: GROK_CATALOG.map(model => ({ ...model })),
  enableImageGen: false,
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
    return () => {
      const index = this.registered.indexOf(entry)
      if (index === -1) return
      this.registered.splice(index, 1)
    }
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
  ctx.provide('connection', {
    rpc: {
      call: async () => ({ ok: true, value: { loggedIn: false } }),
    },
  } as never)
  return { ctx, slots }
}

describe('Grok client plugin registration', () => {
  it('declares only the client services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
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
      ctx.provide('connection', {
      rpc: {
        call: async (channel: string, endpoint: string, payload: unknown) => {
          calls.push({ channel, endpoint, payload })
          if (endpoint === 'settings/read') return { ok: true, value: { settings: value, revision: 1 } }
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
    expect(calls).toContainEqual({ channel: '/grok', endpoint: 'settings/read', payload: {} })
    expect(calls).toContainEqual({ channel: '/grok', endpoint: 'usage/read', payload: {} })
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

    expect(slots.entries('settings.section')).toHaveLength(0) // owned by dsh-llm-providers-ui
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

  it('closes a pre-opened popup when auth/start is malformed', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    const popup = { closed: false, opener: null as Window | null, close: vi.fn(), location: { href: 'about:blank' } }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as never)
    ctx.provide('connection', { rpc: { call: async (_channel: string, endpoint: string) => endpoint === 'settings/read'
      ? { ok: true, value: { settings: value, revision: 1 } }
      : { ok: true, value: { ok: true, authorizationUrl: 7 } } } } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (slots.entries('settings.provider.item')[0] as { inject?: () => { startAuth: () => Promise<unknown> } }).inject?.()
    await face?.startAuth()
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.close).toHaveBeenCalledTimes(1)
    open.mockRestore()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('purges persisted quota on logout without a provider directory', async () => {
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 50 })
    expect(peekCachedUsage('llm-grok')).not.toBeUndefined()
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    ctx.provide('connection', { rpc: { call: async (_channel: string, endpoint: string) => endpoint === 'auth/logout'
      ? { ok: true, value: { ok: true } }
      : { ok: true, value: { loggedIn: false } } } } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (slots.entries('settings.provider.item')[0] as { inject?: () => { logout: () => Promise<unknown> } }).inject?.()
    await face?.logout()
    expect(peekCachedUsage('llm-grok')).toBeUndefined()
    clearProviderUsageCache()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('purges persisted quota on sign-in success signals without a provider directory', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    ctx.provide('connection', { rpc: { call: async (_channel: string, endpoint: string) => {
      if (endpoint === 'auth/complete') return { ok: true, value: { ok: true } }
      if (endpoint === 'auth/attempt-status') return { ok: true, value: { attemptId: 'attempt-1', state: 'succeeded' } }
      return { ok: true, value: { loggedIn: false } }
    } } } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (slots.entries('settings.provider.item')[0] as { inject?: () => {
      completeAuth: (code: string) => Promise<unknown>
      readAuthAttemptStatus: (attemptId: string) => Promise<unknown>
      readAuthStatus: () => Promise<unknown>
    } }).inject?.()
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 50 })
    await face?.completeAuth('code-1')
    expect(peekCachedUsage('llm-grok')).toBeUndefined()
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 50 })
    await face?.readAuthAttemptStatus('attempt-1')
    expect(peekCachedUsage('llm-grok')).toBeUndefined()
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 50 })
    await face?.readAuthStatus()
    expect(peekCachedUsage('llm-grok')).toBeUndefined()
    clearProviderUsageCache()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('purges seeded quota on a logged-out usage response without waiting for auth/status', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    ctx.provide('connection', { rpc: { call: async (_channel: string, endpoint: string) => endpoint === 'usage/read'
      ? { ok: true, value: { status: 'logged-out' } }
      : { ok: true, value: { loggedIn: false } } } } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 50 })
    expect(peekCachedUsage('llm-grok')).not.toBeUndefined()
    const face = (slots.entries('settings.provider.item')[0] as { inject?: () => { fetchUsage: () => Promise<unknown> } }).inject?.()
    await expect(face?.fetchUsage()).resolves.toEqual({ status: 'logged-out' })
    expect(peekCachedUsage('llm-grok')).toBeUndefined()
    clearProviderUsageCache()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('ignores a stale signed-out status that resolves after a new login', async () => {
    let resolveOld: ((value: unknown) => void) | undefined
    let statusCalls = 0
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    ctx.provide('connection', { rpc: { call: async (_channel: string, endpoint: string) => {
      if (endpoint === 'auth/complete') return { ok: true, value: { ok: true } }
      if (endpoint === 'auth/status') {
        statusCalls += 1
        if (statusCalls === 1) return new Promise<unknown>(resolve => { resolveOld = resolve })
      }
      return { ok: true, value: { loggedIn: false } }
    } } } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (slots.entries('settings.provider.item')[0] as { inject?: () => {
      completeAuth: (code: string) => Promise<unknown>
      readAuthStatus: () => Promise<unknown>
    } }).inject?.()
    const old = face?.readAuthStatus()
    await face?.completeAuth('code-1')
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 71 })
    resolveOld?.({ ok: true, value: { loggedIn: false } })
    await expect(old).resolves.toMatchObject({ loggedIn: false })
    expect(peekCachedUsage('llm-grok')?.windows[0]?.remainingPercent).toBe(71)
    clearProviderUsageCache()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('ignores stale logged-out usage that resolves after an account switch', async () => {
    let resolveOld: ((value: unknown) => void) | undefined
    let usageCalls = 0
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const slots = ctx.get('slots') as FakeSlots
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    ctx.provide('connection', { rpc: { call: async (_channel: string, endpoint: string) => {
      if (endpoint === 'auth/complete') return { ok: true, value: { ok: true } }
      if (endpoint === 'usage/read') {
        usageCalls += 1
        if (usageCalls === 1) return new Promise<unknown>(resolve => { resolveOld = resolve })
      }
      return { ok: true, value: { loggedIn: false } }
    } } } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (slots.entries('settings.provider.item')[0] as { inject?: () => {
      completeAuth: (code: string) => Promise<unknown>
      fetchUsage: () => Promise<unknown>
    } }).inject?.()
    const old = face?.fetchUsage()
    await face?.completeAuth('code-1')
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'W', remainingPercent: 71 })
    resolveOld?.({ ok: true, value: { status: 'logged-out' } })
    await expect(old).resolves.toEqual({ status: 'logged-out' })
    expect(peekCachedUsage('llm-grok')?.windows[0]?.remainingPercent).toBe(71)
    clearProviderUsageCache()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
