/** Grok Plugin configuration card: logged-out identity and a read-only catalog. */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { GROK_CATALOG } from '../client-contract.ts'
import type { GrokSettingsKey } from './locales.ts'

/** Dependencies injected by the browser-plugin registration. */
export interface GrokPluginCardFace {
  /** Localized card copy. */
  t: (key: GrokSettingsKey) => string
}

/** Props delivered by the Plugin configuration item slot. */
export type GrokPluginCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<GrokPluginCardFace>

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
  minHeight: 34,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 18,
  padding: '6px 14px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'not-allowed',
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

/** Render the single-package Grok contribution under Plugin configuration. */
export function GrokPluginCard(props: GrokPluginCardProps): ReactNode {
  const { t } = props
  const [open, setOpen] = useState(false)
  const title = t('title')

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
            <section style={sectionStyle} aria-label={t('signedOut')}>
              <p style={statusStyle}>{t('signedOut')}</p>
              <button type="button" style={buttonStyle} disabled>
                {t('signIn')}
              </button>
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
