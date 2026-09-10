// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { clearProviderUsageCache } from 'dsh-llm-providers-ui/usage-readers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { GrokPluginCard } from '../src/client/GrokPluginCard.tsx'
import type { GrokPluginCardProps } from '../src/client/GrokPluginCard.tsx'
import { en } from '../src/client/locales.ts'
import { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/client-contract.ts'
import type { GrokAuthStatus, GrokCatalogModel, GrokSettingsView, GrokUsageReply } from '../src/client-contract.ts'
import { apply, inject } from '../src/client/index.ts'
import { GROK_AUTH_COMPLETE_ENDPOINT, GROK_AUTH_LOGOUT_ENDPOINT, GROK_SETTINGS_NAMESPACE, GROK_SETTINGS_READ_ENDPOINT } from '../src/client-contract.ts'

afterEach(() => { cleanup() })
// Each case starts with an empty shared cache: the dash cases assert "nothing was ever cached".
beforeEach(() => { clearProviderUsageCache() })

const settings: GrokSettingsView = {
  streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  models: GROK_CATALOG.map((model) => ({ ...model })),
  enableImageGen: false,
}

function snapshot(overrides: Partial<SettingsScopeSnapshot<GrokSettingsView>> = {}): SettingsScopeSnapshot<GrokSettingsView> {
  return {
    status: 'ready',
    value: settings,
    base: settings,
    user: {},
    revision: 1,
    writable: true,
    mode: 'host',
    ...overrides,
  }
}

function props(overrides: Partial<GrokPluginCardProps> = {}): GrokPluginCardProps {
  const current = snapshot()
  let adopt: ((models: readonly GrokCatalogModel[]) => void) | undefined
  return {
    t: (key) => en[key],
    useGrokSettings: (selector) => selector(current),
    startAuth: vi.fn(() => Promise.resolve({ ok: true })),
    completeAuth: vi.fn(() => Promise.resolve({ ok: true })),
    cancelAuth: vi.fn(() => Promise.resolve()),
    readAuthAttemptStatus: vi.fn(() => Promise.resolve({ attemptId: 'x', state: 'pending' })),
    readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: false })),
    logout: vi.fn(() => Promise.resolve()),
    fetchUsage: vi.fn(() => Promise.resolve({ status: 'unsupported' })),
    fetchModels: vi.fn(() => Promise.resolve([])),
    saveConfiguration: vi.fn((next) => Promise.resolve({ settings: next, revision: 2 })),
    beginModelPicker: vi.fn((_picked, onAdopt) => { adopt = onAdopt }),
    completeModelPicker: vi.fn((candidates) => { adopt?.(candidates) }),
    failModelPicker: vi.fn(),
    closeModelPicker: vi.fn(),
    ...overrides,
  } as GrokPluginCardProps
}

function expand(): void {
  fireEvent.click(screen.getByRole('button', { name: en.expand + ': ' + en.title }))
}

function openCatalog(): void {
  fireEvent.click(screen.getByRole('button', { name: en.models }))
}

describe('Grok selected-A provider chrome', () => {
  it('renders shared header chrome with role badge and real remaining quota', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve({
      status: 'ok',
      usage: { fetchedAt: '2026-08-17T00:00:00.000Z', windows: [{ id: 'monthly', used: 12, limit: 100, period: 'month' }] },
    }))
    render(<GrokPluginCard {...props({ fetchUsage, readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: true })) })} />)
    expect(document.querySelector('[data-provider-card]')).toBeTruthy()
    expect(document.querySelector('[data-provider-card]')?.getAttribute('data-provider-role')).toBe('llm')
    expect(document.querySelector('[data-provider-card-header]')).toBeTruthy()
    expect(document.querySelector('[data-provider-role-badge]')?.getAttribute('data-provider-role-badge')).toBe('llm')
    expand()
    await waitFor(() => { expect(screen.getAllByRole('meter', { name: 'monthly (month)' }).length).toBe(2) })
    expect(document.querySelector('[data-provider-body]')).toBeTruthy()
    expect(screen.getAllByRole('meter', { name: 'monthly (month)' })[0]?.getAttribute('aria-valuenow')).toBe('88')
    expect(screen.getAllByText('88%').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-provider-quota-meter]')).toBeTruthy()
  })

  it('renders no quota meter when usage is unsupported', async () => {
    render(<GrokPluginCard {...props({ readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: true })) })} />)
    expand()
    await waitFor(() => { expect(screen.getByText(en.usageUnsupported)).toBeTruthy() })
    expect(document.querySelector('[data-provider-quota]')).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('toggles model sort mode while keeping draft inputs mounted', async () => {
    render(<GrokPluginCard {...props()} />)
    expand()
    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    openCatalog()
    const firstInput = screen.getAllByPlaceholderText(en.modelId)[0] as HTMLInputElement
    fireEvent.change(firstInput, { target: { value: 'edited-model-id' } })
    expect(firstInput.value).toBe('edited-model-id')
    expect(document.querySelector('[data-sortable-move]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.sortModels }))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.doneSorting })).toBeTruthy() })
    expect(document.querySelectorAll('[data-sortable-move]').length).toBeGreaterThan(0)
    expect((screen.getAllByPlaceholderText(en.modelId)[0] as HTMLInputElement).value).toBe('edited-model-id')
    expect(document.querySelector('[data-provider-model]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.doneSorting }))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.sortModels })).toBeTruthy() })
    expect((screen.getAllByPlaceholderText(en.modelId)[0] as HTMLInputElement).value).toBe('edited-model-id')
  })
})

describe('Grok provider directory shared header', () => {
  it('registers header shared with its usage reader', async () => {
    class FakeSlots extends Service {
      private readonly registered: Array<{ options: Record<string, unknown> }> = []
      constructor(ctx: Context) { super(ctx, 'slots') }
      inject(_name: string, register: () => () => void): void { this.ctx.effect(register) }
      register(options: Record<string, unknown>, _component: unknown): () => void {
        this.registered.push({ options })
        return () => undefined
      }
    }
    const ctx = new Context()
    await ctx.plugin(FakeSlots).await()
    const register = vi.fn(() => () => undefined)
    ctx.provide('providerDirectory', { register } as never)
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    const rpc = { call: async () => ({ ok: true, value: { settings, revision: 1 } }) }
    ctx.provide('connection', { rpc } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await waitFor(() => { expect(register).toHaveBeenCalled() })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ header: 'shared', key: GROK_SETTINGS_NAMESPACE }))
    expect(GROK_SETTINGS_READ_ENDPOINT.length).toBeGreaterThan(0)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('purges sidebar quota after sign-out and account switch', async () => {
    class FakeSlots2 extends Service {
      private readonly registered: Array<{ options: Record<string, unknown>, inject?: () => unknown }> = []
      constructor(ctx: Context) { super(ctx, 'slots') }
      inject(_name: string, register: () => () => void): void { this.ctx.effect(register) }
      register(options: Record<string, unknown> & { inject?: () => unknown }, _component: unknown): () => void {
        this.registered.push({ options, inject: options.inject })
        return () => undefined
      }
      entries(name: string): Array<{ options: Record<string, unknown>, inject?: () => unknown }> {
        return this.registered.filter((entry) => entry.options['name'] === name)
      }
    }
    const ctx = new Context()
    await ctx.plugin(FakeSlots2).await()
    const slots = ctx.get('slots') as FakeSlots2
    const register = vi.fn(() => () => undefined)
    const invalidateUsage = vi.fn()
    ctx.provide('providerDirectory', { register, invalidateUsage } as never)
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key } as never)
    const rpc = { call: vi.fn(async (_c: string, e: string) => {
      if (e === GROK_AUTH_LOGOUT_ENDPOINT) return { ok: true, value: { ok: true } }
      if (e === GROK_AUTH_COMPLETE_ENDPOINT) return { ok: true, value: { ok: true } }
      return { ok: true, value: { settings, revision: 1 } }
    }) }
    ctx.provide('connection', { rpc } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = slots.entries('settings.provider.item')[0]?.inject?.() as { logout: () => Promise<void>, completeAuth: (code: string) => Promise<{ ok: boolean }> }
    await face.logout()
    expect(invalidateUsage).toHaveBeenCalledWith(GROK_SETTINGS_NAMESPACE)
    invalidateUsage.mockClear()
    await face.completeAuth('code-from-browser')
    expect(invalidateUsage).toHaveBeenCalledWith(GROK_SETTINGS_NAMESPACE)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
