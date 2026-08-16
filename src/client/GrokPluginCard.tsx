/** Grok Plugin configuration card: Host-owned xAI login, usage, and a read-only catalog. */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { GROK_CATALOG } from '../client-contract.ts'
import type {
  GrokAuthStartReply,
  GrokAuthStatus,
  GrokUsageReply,
  GrokUsageView,
  GrokUsageWindow,
} from '../client-contract.ts'
import type { GrokSettingsKey } from './locales.ts'

/** Dependencies injected by the browser-plugin registration. */
export interface GrokPluginCardFace {
  /** Localized card copy. */
  t: (key: GrokSettingsKey) => string
  /** Begin Host PKCE; the browser never receives tokens. */
  startAuth: () => Promise<GrokAuthStartReply>
  /** Deliver a Grok Build paste-code into the in-flight Host exchange. */
  completeAuth: (code: string) => Promise<GrokAuthStartReply>
  /** Read secret-free login status. */
  readAuthStatus: () => Promise<GrokAuthStatus>
  /** Delete the Host session. */
  logout: () => Promise<void>
  /** Read the Host-decoded billing snapshot. Tokens never cross this call. */
  fetchUsage: () => Promise<GrokUsageReply>
}

/** Props delivered by the Plugin configuration item slot. */
export type GrokPluginCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<GrokPluginCardFace>

type AuthUi =
  | { kind: 'signed-out', message?: string }
  | { kind: 'signing-in' }
  | { kind: 'signed-in', email?: string }

type UsageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready', usage: GrokUsageView }
  | { status: 'unsupported' }
  | { status: 'error', message: string }

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
const labelStyle: CSSProperties = { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }
const statusStyle: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }
const errorStyle: CSSProperties = { ...statusStyle, color: 'var(--dsw-alias-state-error-primary)' }
const barTrackStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 14,
  display: 'flex',
  overflow: 'hidden',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)',
}
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
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 36,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '7px 10px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

/** One quota window: used/limit numbers and a solid meter. */
function UsageBar({ usedText, window: quota }: {
  usedText: string
  window: GrokUsageWindow
}): ReactNode {
  const ratio = quota.limit > 0 ? quota.used / quota.limit : quota.used > 0 ? 1 : 0
  const percent = Math.round(ratio * 1000) / 10
  const fill = Math.min(100, Math.max(0, percent))
  const label = quota.period === undefined ? quota.id : `${quota.id} (${quota.period})`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={labelStyle}>{label}</span>
        <span style={hintStyle}>{usedText} {String(quota.used)} / {String(quota.limit)}</span>
      </div>
      <div
        style={barTrackStyle}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
      >
        <span
          data-usage-fill="true"
          style={{
            width: String(fill) + '%',
            height: '100%',
            flex: 'none',
            background: 'var(--dsw-alias-state-business-primary)',
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  )
}

/** Render the single-package Grok contribution under Plugin configuration. */
export function GrokPluginCard(props: GrokPluginCardProps): ReactNode {
  const { t, startAuth, completeAuth, readAuthStatus, logout, fetchUsage } = props
  const [open, setOpen] = useState(false)
  const [auth, setAuth] = useState<AuthUi>({ kind: 'signed-out' })
  const [pasteCode, setPasteCode] = useState('')
  const [usage, setUsage] = useState<UsageState>({ status: 'idle' })
  const title = t('title')
  const busy = auth.kind === 'signing-in'

  const loadUsage = async (): Promise<void> => {
    setUsage({ status: 'loading' })
    try {
      const read = await fetchUsage()
      if (read.status === 'logged-out') {
        setAuth({ kind: 'signed-out' })
        setUsage({ status: 'idle' })
        return
      }
      if (read.status === 'unsupported') {
        setUsage({ status: 'unsupported' })
        return
      }
      setUsage({ status: 'ready', usage: read.usage })
    } catch (error: unknown) {
      setUsage({ status: 'error', message: messageOf(error, t('usageFailed')) })
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void readAuthStatus().then((status) => {
      if (cancelled) return
      if (status.loggedIn) {
        setAuth({ kind: 'signed-in', ...status.email === undefined ? {} : { email: status.email } })
        return
      }
      setAuth({ kind: 'signed-out' })
      setUsage({ status: 'idle' })
    }).catch(() => {
      if (!cancelled) {
        setAuth({ kind: 'signed-out', message: t('statusFailed') })
        setUsage({ status: 'idle' })
      }
    })
    return () => { cancelled = true }
  }, [open, readAuthStatus, t])

  useEffect(() => {
    if (!open || auth.kind !== 'signed-in' || usage.status !== 'idle') return
    void loadUsage()
  }, [open, auth.kind, usage.status])

  const onSignIn = async (): Promise<void> => {
    setAuth({ kind: 'signing-in' })
    setPasteCode('')
    setUsage({ status: 'idle' })
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

  const onPasteCode = async (): Promise<void> => {
    const code = pasteCode.trim()
    if (code.length === 0) {
      setAuth({ kind: 'signing-in' })
      return
    }
    try {
      const completed = await completeAuth(code)
      if (!completed.ok) {
        setAuth({ kind: 'signing-in' })
      }
    } catch {
      setAuth({ kind: 'signing-in' })
    }
  }

  const onSignOut = async (): Promise<void> => {
    try {
      await logout()
      setAuth({ kind: 'signed-out' })
      setUsage({ status: 'idle' })
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
                  <>
                    <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void onSignIn() }}>
                      {t('signIn')}
                    </button>
                    {auth.kind === 'signing-in'
                      ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <p style={hintStyle}>{t('pasteCode')}</p>
                          <label style={labelStyle} htmlFor="grok-oauth-code">{t('pasteCodeLabel')}</label>
                          <input
                            id="grok-oauth-code"
                            style={inputStyle}
                            value={pasteCode}
                            autoComplete="off"
                            spellCheck={false}
                            aria-label={t('pasteCodeLabel')}
                            onChange={event => { setPasteCode(event.target.value) }}
                          />
                          <button
                            type="button"
                            style={buttonStyle}
                            disabled={pasteCode.trim().length === 0}
                            onClick={() => { void onPasteCode() }}
                          >
                            {t('pasteCodeSubmit')}
                          </button>
                        </div>
                      )
                      : null}
                  </>
                )}
            </section>
            {auth.kind === 'signed-in'
              ? (
                <section style={sectionStyle} aria-label={t('usage')}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <h3 style={sectionTitleStyle}>{t('usage')}</h3>
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={usage.status === 'loading'}
                      onClick={() => { void loadUsage() }}
                    >
                      {t(usage.status === 'loading' ? 'usageLoading' : 'usageRefresh')}
                    </button>
                  </div>
                  {usage.status === 'ready'
                    ? usage.usage.windows.map((window, index) => (
                      <UsageBar
                        key={`${window.id}:${String(index)}`}
                        usedText={t('usageUsed')}
                        window={window}
                      />
                    ))
                    : null}
                  {usage.status === 'unsupported' ? <p style={hintStyle}>{t('usageUnsupported')}</p> : null}
                  {usage.status === 'error' ? <p style={errorStyle}>{usage.message}</p> : null}
                </section>
              )
              : null}
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
