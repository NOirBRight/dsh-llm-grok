// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrokPluginCard } from '../src/client/GrokPluginCard.tsx'
import type { GrokPluginCardProps } from '../src/client/GrokPluginCard.tsx'
import { en } from '../src/client/locales.ts'
import type { GrokAuthStartReply, GrokAuthStatus } from '../src/client-contract.ts'

afterEach(() => { cleanup() })

function props(overrides: Partial<GrokPluginCardProps> = {}): GrokPluginCardProps {
  return {
    t: key => en[key],
    startAuth: vi.fn(() => Promise.resolve({ ok: true } satisfies GrokAuthStartReply)),
    readAuthStatus: vi.fn(() => Promise.resolve({ loggedIn: false } satisfies GrokAuthStatus)),
    logout: vi.fn(() => Promise.resolve()),
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
    render(<GrokPluginCard {...props()} />)
    expand()

    await waitFor(() => { expect(screen.getByText(en.signedOut)).toBeTruthy() })
    const signIn = screen.getByRole<HTMLButtonElement>('button', { name: en.signIn })
    expect(signIn.disabled).toBe(false)
    expect(screen.getByText('grok-4.6')).toBeTruthy()
    const row = document.querySelector('[data-model-row="grok-4.6"]')
    expect(row?.textContent).toContain(en.thinking)
    expect(row?.textContent).toContain(en.vision)
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByText(/usage/i)).toBeNull()
    expect(screen.queryByRole('button', { name: en.signOut })).toBeNull()
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
})
