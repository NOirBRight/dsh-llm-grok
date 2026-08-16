// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrokPluginCard } from '../src/client/GrokPluginCard.tsx'
import type { GrokPluginCardProps } from '../src/client/GrokPluginCard.tsx'
import { en } from '../src/client/locales.ts'
import type { GrokAuthStartReply, GrokAuthStatus, GrokUsageReply } from '../src/client-contract.ts'

afterEach(() => { cleanup() })

function props(overrides: Partial<GrokPluginCardProps> = {}): GrokPluginCardProps {
  return {
    t: key => en[key],
    startAuth: vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply)),
    completeAuth: vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply)),
    readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: false } satisfies GrokAuthStatus)),
    logout: vi.fn(() => Promise.resolve()),
    fetchUsage: vi.fn(() => Promise.resolve({ status: 'unsupported' } satisfies GrokUsageReply)),
    ...overrides,
  } as GrokPluginCardProps
}

function expand(): void {
  fireEvent.click(screen.getByRole('button', { name: `${en.expand}: ${en.title}` }))
}

describe('GrokPluginCard', () => {
  it('shows the Grok title while collapsed', () => {
    render(<GrokPluginCard {...props()} />)

    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByRole('button', { name: `${en.expand}: ${en.title}` })).toBeTruthy()
  })

  it('renders a logged-out state with an enabled sign-in control and grok-4.6 catalog flags', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve({ status: 'unsupported' } satisfies GrokUsageReply))
    render(<GrokPluginCard {...props({ fetchUsage })} />)
    expand()

    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    const signIn = screen.getByRole<HTMLButtonElement>('button', { name: en.signIn })
    expect(signIn.disabled).toBe(false)
    expect(screen.getByText('grok-4.6')).toBeTruthy()
    const row = document.querySelector('[data-model-row="grok-4.6"]')
    expect(row?.textContent).toContain(en.thinking)
    expect(row?.textContent).toContain(en.vision)
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByText(en.usage)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: en.signOut })).toBeNull()
    expect(fetchUsage).not.toHaveBeenCalled()
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
