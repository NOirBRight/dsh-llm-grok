// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GrokPluginCard } from '../src/client/GrokPluginCard.tsx'
import type { GrokPluginCardProps } from '../src/client/GrokPluginCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

function props(overrides: Partial<GrokPluginCardProps> = {}): GrokPluginCardProps {
  return {
    t: key => en[key],
    ...overrides,
  } as GrokPluginCardProps
}

describe('GrokPluginCard', () => {
  it('shows the Grok title while collapsed', () => {
    render(<GrokPluginCard {...props()} />)

    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByRole('button', { name: `${en.expand}: ${en.title}` })).toBeTruthy()
  })

  it('renders a logged-out state with an inert sign-in control and grok-4.6 catalog flags', () => {
    render(<GrokPluginCard {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: `${en.expand}: ${en.title}` }))

    expect(screen.getByText(en.signedOut)).toBeTruthy()
    const signIn = screen.getByRole<HTMLButtonElement>('button', { name: en.signIn })
    expect(signIn.disabled).toBe(true)
    expect(screen.getByText('grok-4.6')).toBeTruthy()
    const row = document.querySelector('[data-model-row="grok-4.6"]')
    expect(row?.textContent).toContain(en.thinking)
    expect(row?.textContent).toContain(en.vision)
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByText(/usage/i)).toBeNull()
  })
})
