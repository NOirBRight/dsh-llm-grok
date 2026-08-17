// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { GrokPluginCard } from '../src/client/GrokPluginCard.tsx'
import type { GrokPluginCardProps } from '../src/client/GrokPluginCard.tsx'
import { en } from '../src/client/locales.ts'
import { GROK_CATALOG, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/client-contract.ts'
import type { GrokAuthStartReply, GrokAuthStatus, GrokCatalogModel, GrokSettingsView, GrokUsageReply } from '../src/client-contract.ts'

afterEach(() => { cleanup() })

const settings: GrokSettingsView = {
  streamIdleTimeoutMs: GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  models: GROK_CATALOG.map(model => ({ ...model })),
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
    t: key => en[key],
    useGrokSettings: selector => selector(current),
    startAuth: vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply)),
    completeAuth: vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply)),
    readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: false } satisfies GrokAuthStatus)),
    logout: vi.fn(() => Promise.resolve()),
    fetchUsage: vi.fn(() => Promise.resolve({ status: 'unsupported' } satisfies GrokUsageReply)),
    fetchModels: vi.fn(() => Promise.resolve([])),
    saveConfiguration: vi.fn(next => Promise.resolve({ settings: next, revision: 2 })),
    beginModelPicker: vi.fn((_picked, onAdopt) => { adopt = onAdopt }),
    completeModelPicker: vi.fn(candidates => { adopt?.(candidates) }),
    failModelPicker: vi.fn(),
    closeModelPicker: vi.fn(),
    ...overrides,
  } as GrokPluginCardProps
}

function expand(): void {
  fireEvent.click(screen.getByRole('button', { name: `${en.expand}: ${en.title}` }))
}

function openCatalog(): void {
  fireEvent.click(screen.getByRole('button', { name: en.models }))
}

describe('GrokPluginCard', () => {
  it('shows the Grok title while collapsed', () => {
    render(<GrokPluginCard {...props()} />)

    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByRole('button', { name: `${en.expand}: ${en.title}` })).toBeTruthy()
  })

  it('renders a logged-out state with an enabled sign-in control and a collapsed catalog', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve({ status: 'unsupported' } satisfies GrokUsageReply))
    render(<GrokPluginCard {...props({ fetchUsage })} />)
    expand()

    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    const signIn = screen.getByRole<HTMLButtonElement>('button', { name: en.signIn })
    expect(signIn.disabled).toBe(false)
    expect(document.querySelector('[data-model-row="grok-4.6"]')).toBeNull()
    openCatalog()
    expect(document.querySelector('[data-model-row="grok-4.6"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${en.modelDetails}: grok-4.6` }))
    expect(screen.getByLabelText(en.thinking)).toBeTruthy()
    expect(screen.getByLabelText(en.vision)).toBeTruthy()
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByText(en.usage)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: en.signOut })).toBeNull()
    expect(fetchUsage).not.toHaveBeenCalled()
  })

  it('saves a displayed subset without replacing it from the account list', async () => {
    const saveConfiguration = vi.fn((next: GrokSettingsView) => Promise.resolve({ settings: next, revision: 2 }))
    const fetchModels = vi.fn(() => Promise.resolve([
      { id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true },
      { id: 'grok-4.5', name: 'Grok 4.5', thinking: true, vision: true },
    ]))
    render(<GrokPluginCard {...props({ saveConfiguration, fetchModels })} />)
    expand()
    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    openCatalog()
    fireEvent.click(screen.getByRole('button', { name: `${en.remove} grok-4.5` }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(saveConfiguration).toHaveBeenCalledTimes(1) })
    expect(saveConfiguration.mock.calls[0]?.[0]?.models.map((model: GrokCatalogModel) => model.id)).toEqual(['grok-4.6'])
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('adopts a subset from the account picker without adding the rest', async () => {
    const fetchModels = vi.fn(() => Promise.resolve([
      { id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true },
      { id: 'grok-4.5', name: 'Grok 4.5', thinking: true, vision: true },
    ]))
    let adopt: ((models: readonly GrokCatalogModel[]) => void) | undefined
    const beginModelPicker = vi.fn((_picked: ReadonlySet<string>, onAdopt: (models: readonly GrokCatalogModel[]) => void) => {
      adopt = onAdopt
    })
    const completeModelPicker = vi.fn((candidates: readonly GrokCatalogModel[]) => {
      adopt?.(candidates.filter(model => model.id === 'grok-4.6'))
    })
    const saveConfiguration = vi.fn((next: GrokSettingsView) => Promise.resolve({ settings: next, revision: 2 }))
    render(<GrokPluginCard {...props({ fetchModels, beginModelPicker, completeModelPicker, saveConfiguration })} />)
    expand()
    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.fetchModels }))
    await waitFor(() => { expect(fetchModels).toHaveBeenCalledTimes(1) })
    expect(completeModelPicker).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(saveConfiguration).toHaveBeenCalledTimes(1) })
    expect(saveConfiguration.mock.calls[0]?.[0]?.models.map((model: GrokCatalogModel) => model.id)).toEqual(['grok-4.6'])
  })

  it('signs in through mock RPC and then shows the account identity', async () => {
    const startAuth = vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply))
    const readAuthStatus = vi.fn()
      .mockResolvedValueOnce({ loggedIn: false } satisfies GrokAuthStatus)
      .mockResolvedValueOnce({
        loggedIn: true,
        email: 'user@example.test',
        expiresAt: '2026-08-17T12:00:00.000Z',
      } satisfies GrokAuthStatus)
    render(<GrokPluginCard {...props({ startAuth, readAuthStatus })} />)
    expand()
    await waitFor(() => { expect(screen.getByRole('button', { name: en.signIn })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.signIn }))

    await waitFor(() => {
      expect(startAuth).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Signed in as user@example.test.')).toBeTruthy()
    })
    expect(readAuthStatus).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: en.signOut })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
    expect(JSON.stringify(startAuth.mock.results)).not.toMatch(/accessToken|refreshToken/u)
  })

  it('lets the user paste a Grok Build code while sign-in is waiting', async () => {
    let finishStart: ((value: GrokAuthStartReply) => void) | undefined
    const startAuth = vi.fn(() => new Promise<GrokAuthStartReply>(resolve => {
      finishStart = resolve
    }))
    const completeAuth = vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply))
    const readAuthStatus = vi.fn()
      .mockResolvedValueOnce({ loggedIn: false } satisfies GrokAuthStatus)
      .mockResolvedValueOnce({
        loggedIn: true,
        email: 'user@example.test',
      } satisfies GrokAuthStatus)
    render(<GrokPluginCard {...props({ startAuth, completeAuth, readAuthStatus })} />)
    expand()
    await waitFor(() => { expect(screen.getByRole('button', { name: en.signIn })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    await waitFor(() => { expect(screen.getByLabelText(en.pasteCodeLabel)).toBeTruthy() })
    fireEvent.change(screen.getByLabelText(en.pasteCodeLabel), { target: { value: 'paste-code-1' } })
    fireEvent.click(screen.getByRole('button', { name: en.pasteCodeSubmit }))

    await waitFor(() => { expect(completeAuth).toHaveBeenCalledWith('paste-code-1') })
    finishStart?.({ ok: true })
    await waitFor(() => {
      expect(screen.getByText('Signed in as user@example.test.')).toBeTruthy()
    })
  })

  it('signs out through mock RPC and returns to the logged-out card', async () => {
    const logout = vi.fn(() => Promise.resolve())
    const readAuthStatus = vi.fn(() => Promise.resolve({
      loggedIn: true,
      email: 'user@example.test',
    } satisfies GrokAuthStatus))
    render(<GrokPluginCard {...props({ logout, readAuthStatus })} />)
    expand()
    await waitFor(() => { expect(screen.getByText('Signed in as user@example.test.')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.signOut }))

    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    expect(logout).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: en.signIn })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signOut })).toBeNull()
  })

  it('shows usage windows from a decoded billing snapshot when signed in', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve({
      status: 'ok',
      usage: {
        fetchedAt: '2026-08-17T00:00:00.000Z',
        windows: [
          { id: 'monthly', used: 12, limit: 100, period: 'month' },
          { id: 'weekly', used: 3, limit: 20 },
        ],
      },
    } satisfies GrokUsageReply))
    render(<GrokPluginCard {...props({
      fetchUsage,
      readAuthStatus: vi.fn(() => Promise.resolve({
        loggedIn: true,
        email: 'user@example.test',
      } satisfies GrokAuthStatus)),
    })} />)
    expand()

    await waitFor(() => { expect(screen.getByText(`${en.usageUsed} 12 / 100`)).toBeTruthy() })
    expect(screen.getByText('monthly (month)')).toBeTruthy()
    expect(screen.getByText(`${en.usageUsed} 3 / 20`)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'monthly (month)' }).getAttribute('aria-valuenow')).toBe('12')
    expect(screen.getByRole('progressbar', { name: 'weekly' }).querySelectorAll('[data-usage-fill]')).toHaveLength(1)
    expect(fetchUsage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(fetchUsage.mock.results)).not.toMatch(/accessToken|refreshToken|Bearer/u)
  })

  it('explains when billing has no usage surface', async () => {
    render(<GrokPluginCard {...props({
      readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: true } satisfies GrokAuthStatus)),
    })} />)
    expand()

    await waitFor(() => { expect(screen.getByText(en.usageUnsupported)).toBeTruthy() })
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows a usage read failure without secrets and retries on demand', async () => {
    const fetchUsage = vi.fn()
      .mockRejectedValueOnce(new Error('could not reach https://cli-chat-proxy.grok.com/v1/billing'))
      .mockResolvedValueOnce({
        status: 'ok',
        usage: {
          fetchedAt: '2026-08-17T00:00:00.000Z',
          windows: [{ id: 'monthly', used: 1, limit: 10 }],
        },
      } satisfies GrokUsageReply)
    render(<GrokPluginCard {...props({
      fetchUsage,
      readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: true } satisfies GrokAuthStatus)),
    })} />)
    expand()

    await waitFor(() => {
      expect(screen.getByText('could not reach https://cli-chat-proxy.grok.com/v1/billing')).toBeTruthy()
    })
    expect(screen.getByText('could not reach https://cli-chat-proxy.grok.com/v1/billing').textContent)
      .not.toMatch(/accessToken|Bearer /u)
    fireEvent.click(screen.getByRole('button', { name: en.usageRefresh }))
    await waitFor(() => { expect(screen.getByText(`${en.usageUsed} 1 / 10`)).toBeTruthy() })
    expect(fetchUsage).toHaveBeenCalledTimes(2)
  })
})
