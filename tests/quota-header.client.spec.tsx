// @vitest-environment jsdom
// Collapsed header quota: usage loads collapsed without expansion, expansion never refires, failures stay truthful.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { GrokPluginCard } from '../src/client/GrokPluginCard.tsx'
import type { GrokPluginCardProps } from '../src/client/GrokPluginCard.tsx'
import { en } from '../src/client/locales.ts'
import { clearProviderUsageCache, rememberHeadlineQuota } from 'dsh-llm-providers-ui/usage-readers'
import { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/client-contract.ts'
import type { GrokSettingsView, GrokUsageReply } from '../src/client-contract.ts'

afterEach(() => { cleanup() })
// Each case starts with an empty shared cache: the dash cases assert "nothing was ever cached".
beforeEach(() => { clearProviderUsageCache() })

const settings: GrokSettingsView = {
  streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  models: GROK_CATALOG.map(model => ({ ...model })),
  enableImageGen: false,
}

const usageOk: GrokUsageReply = {
  status: 'ok',
  usage: {
    fetchedAt: '2026-09-01T00:00:00.000Z',
    windows: [
      { id: 'monthly', used: 12, limit: 100, period: 'month' },
      { id: 'weekly', used: 3, limit: 20 },
    ],
  },
}

function props(overrides: Record<string, unknown> = {}): GrokPluginCardProps {
  const current: SettingsScopeSnapshot<GrokSettingsView> = {
    status: 'ready', value: settings, base: settings, user: {}, revision: 1, writable: true, mode: 'host',
  }
  return {
    t: (key: keyof typeof en) => en[key],
    useGrokSettings: (selector: (value: SettingsScopeSnapshot<GrokSettingsView>) => unknown) => selector(current),
    startAuth: vi.fn(),
    completeAuth: vi.fn(),
    cancelAuth: vi.fn(),
    readAuthAttemptStatus: vi.fn(),
    readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: true as const })),
    logout: vi.fn(),
    fetchUsage: vi.fn(() => Promise.resolve(usageOk)),
    fetchModels: vi.fn(() => Promise.resolve([])),
    saveConfiguration: vi.fn(next => Promise.resolve({ settings: next, revision: 2 })),
    beginModelPicker: vi.fn(),
    completeModelPicker: vi.fn(),
    failModelPicker: vi.fn(),
    closeModelPicker: vi.fn(),
    ...overrides,
  } as unknown as GrokPluginCardProps
}

describe('GrokPluginCard collapsed quota', () => {
  it('paints the shared cached quota before any live answer arrives', async () => {
    clearProviderUsageCache()
    rememberHeadlineQuota('llm-grok', 'Grok', { label: 'GrokBuild', remainingPercent: 37 })
    // The live read never settles: the cached value must be the only source.
    const fetchUsage = vi.fn(() => new Promise<GrokUsageReply>(() => undefined))
    render(<GrokPluginCard {...props({ fetchUsage })} />)

    const meter = await screen.findByRole('meter', { name: 'GrokBuild' })
    expect(meter.getAttribute('aria-valuenow')).toBe('37')
    clearProviderUsageCache()
  })

  it('shows header quota while collapsed and does not reload on expansion', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve(usageOk))
    render(<GrokPluginCard {...props({ fetchUsage })} />)

    const meter = await screen.findByRole('meter', { name: 'monthly (month)' })
    expect(meter.getAttribute('aria-valuenow')).toBe('88')
    expect(fetchUsage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: en.expand + ': ' + en.title }))
    await screen.findByRole('button', { name: en.usageRefresh })
    expect(screen.getAllByRole('meter', { name: 'monthly (month)' }).length).toBeGreaterThanOrEqual(2)
    expect(fetchUsage).toHaveBeenCalledTimes(1)
  })

  it('reports a usage read failure truthfully with a collapsed unavailable dash', async () => {
    const fetchUsage = vi.fn(() => Promise.reject(new Error('billing down')))
    render(<GrokPluginCard {...props({ fetchUsage })} />)

    await waitFor(() => { expect(fetchUsage).toHaveBeenCalledTimes(1) })
    // Truthful unavailable state: dash mini, never a fabricated percent.
    expect(document.querySelector('[data-provider-quota-mini] [data-provider-quota-missing]')).not.toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.expand + ': ' + en.title }))
    await screen.findByText('billing down')
    expect(fetchUsage).toHaveBeenCalledTimes(1)
  })
})
