/** Grok Plugin configuration card: Host-owned xAI login and a read-only catalog. */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { GROK_CATALOG } from '../client-contract.ts'
import type { GrokAuthStartReply, GrokAuthStatus } from '../client-contract.ts'
import type { GrokSettingsKey } from './locales.ts'

/** Dependencies injected by the browser-plugin registration. */
export interface GrokPluginCardFace {
  /** Localized card copy. */
  t: (key: GrokSettingsKey) => string
  /** Begin Host PKCE; the browser never receives tokens. */
  startAuth: () => Promise<GrokAuthStartReply>
  /** Read secret-free login status. */
  readAuthStatus: () => Promise<GrokAuthStatus>
  /** Delete the Host session. */
  logout: () => Promise<void>
}

/** Props delivered by the Plugin configuration item slot. */
export type GrokPluginCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<GrokPluginCardFace>

type AuthUi =
  | { kind: 'signed-out', message?: string }
  | { kind: 'signing-in' }
  | { kind: 'signed-in', email?: string }

const cardStyle: CSSProperties = {
  overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
}
const headerStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  border: 0,
  padding: '13px 14px',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}
const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  padding: '16px 14px 18px',
}
const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}
const hintStyle: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
const statusStyle: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }
const buttonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  minHeight: 34,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 18,
  padding: '6px 14px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'pointer',
}
const catalogStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const modelRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '8px 10px',
}
const flagsStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }

function formatSignedIn(t: GrokPluginCardFace['t'], email: string | undefined): string {
  if (email === undefined) return t('signedInNoEmail')
  return t('signedInAs').replace('{email}', email)
}

/** Render the single-package Grok contribution under Plugin configuration. */
export function GrokPluginCard(props: GrokPluginCardProps): ReactNode {
  const { t, startAuth, readAuthStatus, logout } = props
  const [open, setOpen] = useState(false)
  const [auth, setAuth] = useState<AuthUi>({ kind: 'signed-out' })
  const title = t('title')
  const busy = auth.kind === 'signing-in'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void readAuthStatus().then((status) => {
      if (cancelled) return
      setAuth(status.loggedIn
        ? { kind: 'signed-in', ...status.email === undefined ? {} : { email: status.email } }
        : { kind: 'signed-out' })
    }).catch(() => {
      if (!cancelled) setAuth({ kind: 'signed-out', message: t('statusFailed') })
    })
    return () => { cancelled = true }
  }, [open, readAuthStatus, t])

  const onSignIn = async (): Promise<void> => {
    setAuth({ kind: 'signing-in' })
    try {
      const started = await startAuth()
      if (!started.ok) {
        setAuth({ kind: 'signed-out', message: started.message || t('signInFailed') })
        return
      }
      const status = await readAuthStatus()
      setAuth(status.loggedIn
        ? { kind: 'signed-in', ...status.email === undefined ? {} : { email: status.email } }
        : { kind: 'signed-out', message: t('signInFailed') })
    } catch {
      setAuth({ kind: 'signed-out', message: t('signInFailed') })
    }
  }

  const onSignOut = async (): Promise<void> => {
    try {
      await logout()
      setAuth({ kind: 'signed-out' })
    } catch {
      setAuth(current => current.kind === 'signed-in'
        ? current
        : { kind: 'signed-out', message: t('signOutFailed') })
    }
  }

  const statusLabel = auth.kind === 'signing-in'
    ? t('signingIn')
    : auth.kind === 'signed-in'
      ? formatSignedIn(t, auth.email)
      : auth.message ?? t('signedOut')

  return (
    <li style={cardStyle}>
      <button
        type="button"
        style={headerStyle}
        aria-expanded={open}
        aria-label={t(open ? 'collapse' : 'expand') + ': ' + title}
        onClick={() => { setOpen(!open) }}
      >
        <span style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
            {t('description')}
          </span>
        </span>
        <span aria-hidden="true" style={{ fontSize: 18, transform: open ? 'rotate(180deg)' : 'none' }}>⌄</span>
      </button>
      {open
        ? (
          <div style={bodyStyle}>
            <section style={sectionStyle} aria-label={statusLabel}>
              <p style={statusStyle}>{statusLabel}</p>
              {auth.kind === 'signed-in'
                ? (
                  <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void onSignOut() }}>
                    {t('signOut')}
                  </button>
                )
                : (
                  <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void onSignIn() }}>
                    {t('signIn')}
                  </button>
                )}
            </section>
            <section style={sectionStyle} aria-label={t('models')}>
              <h3 style={sectionTitleStyle}>{t('models')}</h3>
              <ul style={catalogStyle}>
                {GROK_CATALOG.map((model) => (
                  <li key={model.id} data-model-row={model.id} style={modelRowStyle}>
                    <span>{model.id}</span>
                    <span style={flagsStyle}>
                      {model.thinking === true ? <span style={hintStyle}>{t('thinking')}</span> : null}
                      {model.vision === true ? <span style={hintStyle}>{t('vision')}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )
        : null}
    </li>
  )
}
