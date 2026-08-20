/** Grok Plugin configuration card: Host-owned xAI login, usage, and an editable displayed catalog. */

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  GrokAuthStartReply,
  GrokAuthStatus,
  GrokCatalogModel,
  GrokSaveResult,
  GrokSettingsView,
  GrokUsageReply,
  GrokUsageView,
  GrokUsageWindow,
} from '../client-contract.ts'
import { officialDefaultEffort, officialEffortsFor } from '../reasoning.ts'
import type { GrokSettingsKey } from './locales.ts'
import { BrandMark } from './BrandMark.tsx'
import { AuthToolbar, ProviderCardHeader, UsageHeader, UsageResetAt, UsageSkeleton, UsageUpdatedAt, formatProviderSummary, formatUsageClock, providerHeaderStyle, resetLabelOf } from './provider-chrome.tsx'
import type {} from './provider-section.ts'
import { SortableList } from './SortableList.tsx'

/** Dependencies injected by the browser-plugin registration. */
export interface GrokPluginCardFace {
  /** Localized card copy. */
  t: (key: GrokSettingsKey) => string
  hooks: {
    /** Reactive Host-owned settings section. */
    grokSettings: SettingsScope<GrokSettingsView>
  }
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
  /** Read the signed-in account catalog (picker candidates, not the displayed set). */
  fetchModels: () => Promise<readonly GrokCatalogModel[]>
  /** Atomically store the displayed catalog. */
  saveConfiguration: (settings: GrokSettingsView) => Promise<GrokSaveResult>
  /** Open the frame-level picker immediately with the current selected ids. */
  beginModelPicker: (initiallyPicked: ReadonlySet<string>, onAdopt: (models: readonly GrokCatalogModel[]) => void) => void
  /** Populate the open picker with account candidates. */
  completeModelPicker: (candidates: readonly GrokCatalogModel[]) => void
  /** Show a discovery failure in the open picker. */
  failModelPicker: (message: string) => void
  /** Close a picker whose owning settings card unmounts. */
  closeModelPicker: () => void
}

/** Props delivered by the Plugin configuration item slot. */
export type GrokPluginCardProps =
  PropsRuntime<'settings.provider.item'>
  & InjectFace<GrokPluginCardFace>

type AuthUi =
  | { kind: 'signed-out', message?: string }
  | { kind: 'signing-in' }
  | { kind: 'signed-in', email?: string }

interface ModelDraft {
  /** Client-only stable identity; stripped before settings are saved. */
  rowId: string
  id: string
  name?: string
  thinking?: boolean
  vision?: boolean
  defaultReasoningEffort?: string
  contextWindow: string
  reasoningEfforts?: GrokCatalogModel['reasoningEfforts']
}

type ModelPatch = {
  [Key in keyof ModelDraft]?: ModelDraft[Key] | undefined
}

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
const headerStyle = providerHeaderStyle
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
const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--dsw-alias-button-primary-fill)',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
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
const rowInputStyle: CSSProperties = { ...inputStyle, minHeight: 32, padding: '4px 10px' }
const actionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }
const iconButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  border: 0,
  borderRadius: 6,
  padding: 0,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  font: 'inherit',
  cursor: 'pointer',
}
const disclosureStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  border: 0,
  padding: 0,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}
const modelContentStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto auto',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
}
const modelDetailStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 14,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  padding: '10px 4px 4px',
}

let nextModelRow = 0

/** Stable client-only row identity used by the pointer sortable preview. */
function newModelRowId(): string {
  nextModelRow += 1
  return 'grok-model-row-' + String(nextModelRow)
}

function integerOf(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  if (!/^[1-9]\d*$/u.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

function modelDraftOf(model: GrokCatalogModel): ModelDraft {
  return {
    rowId: newModelRowId(),
    id: model.id,
    contextWindow: model.contextWindow === undefined ? '' : String(model.contextWindow),
    ...model.name === undefined ? {} : { name: model.name },
    ...model.thinking === undefined ? {} : { thinking: model.thinking },
    ...model.vision === undefined ? {} : { vision: model.vision },
    ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
  }
}

function modelSettingsOf(draft: ModelDraft): GrokCatalogModel {
  const contextWindow = integerOf(draft.contextWindow)
  return {
    id: draft.id.trim(),
    ...draft.name === undefined || draft.name.trim().length === 0 ? {} : { name: draft.name.trim() },
    ...draft.thinking === undefined ? {} : { thinking: draft.thinking },
    ...draft.vision === undefined ? {} : { vision: draft.vision },
    ...draft.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: draft.defaultReasoningEffort },
    ...contextWindow === undefined || Number.isNaN(contextWindow) ? {} : { contextWindow },
    ...draft.reasoningEfforts === undefined ? {} : { reasoningEfforts: draft.reasoningEfforts },
  }
}

function sameDraft(left: readonly ModelDraft[], right: readonly ModelDraft[]): boolean {
  return JSON.stringify(left.map(modelSettingsOf)) === JSON.stringify(right.map(modelSettingsOf))
}

function modelFailure(models: readonly ModelDraft[]): boolean {
  const ids = new Set<string>()
  for (const model of models) {
    const id = model.id.trim()
    if (id.length === 0 || ids.has(id)) return true
    if (Number.isNaN(integerOf(model.contextWindow))) return true
    ids.add(id)
  }
  return false
}

function formatSignedIn(t: GrokPluginCardFace['t'], email: string | undefined): string {
  if (email === undefined) return t('signedInNoEmail')
  return t('signedInAs').replace('{email}', email)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

function Capability({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}): ReactNode {
  return (
    <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.checked) }}
      />
      {label}
    </label>
  )
}

function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ flex: 'none', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** One quota window: used/limit numbers and a solid meter. */
function UsageBar({ usedText, window: quota, t }: {
  usedText: string
  window: GrokUsageWindow
  t: GrokPluginCardFace['t']
}): ReactNode {
  const ratio = quota.limit > 0 ? quota.used / quota.limit : quota.used > 0 ? 1 : 0
  const percent = Math.round(ratio * 1000) / 10
  const fill = Math.min(100, Math.max(0, percent))
  const label = quota.period === undefined || quota.resetsAt !== undefined
    ? quota.id
    : quota.id + ' (' + quota.period + ')'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={labelStyle}>{label}</span>
        <span style={hintStyle}>
          {quota.unit === 'percent'
            ? String(quota.used) + '%'
            : usedText + ' ' + String(quota.used) + ' / ' + String(quota.limit)}
        </span>
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
      <UsageResetAt label={resetLabelOf(quota.resetsAt, usageResetCopy(t))} />
    </div>
  )
}

function usageResetCopy(t: GrokPluginCardFace['t']): { at: string, atDays: string } {
  return { at: t('usageResetAt'), atDays: t('usageResetAtDays') }
}

/** Render the single-package Grok contribution under Plugin configuration. */
export function GrokPluginCard(props: GrokPluginCardProps): ReactNode {
  const { t, startAuth, completeAuth, readAuthStatus, logout, fetchUsage, fetchModels } = props
  const snapshot = props.useGrokSettings(value => value)
  const [open, setOpen] = useState(false)
  const initial = useMemo(
    () => snapshot.value === undefined ? undefined : snapshot.value.models.map(modelDraftOf),
    [snapshot.value],
  )
  const [source, setSource] = useState<ModelDraft[] | undefined>(initial)
  const [draft, setDraft] = useState<ModelDraft[] | undefined>(initial)
  const [sourceRevision, setSourceRevision] = useState<number | undefined>(snapshot.revision)
  const [auth, setAuth] = useState<AuthUi>({ kind: 'signed-out' })
  const [pasteCode, setPasteCode] = useState('')
  const [usage, setUsage] = useState<UsageState>({ status: 'idle' })
  const [lastUsage, setLastUsage] = useState<GrokUsageView | undefined>(undefined)
  const [usageUpdatedAt, setUsageUpdatedAt] = useState<Date | undefined>(undefined)
  const [enableImageGen, setEnableImageGen] = useState(snapshot.value?.enableImageGen === true)
  const [sourceEnableImageGen, setSourceEnableImageGen] = useState(snapshot.value?.enableImageGen === true)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [expandedModels, setExpandedModels] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const title = t('title')
  const signingIn = auth.kind === 'signing-in'
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || busy
  const dirty = (source !== undefined && draft !== undefined && !sameDraft(source, draft))
    || enableImageGen !== sourceEnableImageGen
  const invalid = draft !== undefined && modelFailure(draft)
  const customModels = snapshot.user !== undefined
    && Object.prototype.hasOwnProperty.call(snapshot.user, 'models')

  useEffect(() => {
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    if (snapshot.revision === sourceRevision) return
    if (dirty) return
    const next = snapshot.value.models.map(modelDraftOf)
    setSource(next)
    setDraft(next)
    setEnableImageGen(snapshot.value.enableImageGen)
    setSourceEnableImageGen(snapshot.value.enableImageGen)
    setSourceRevision(snapshot.revision)
  }, [dirty, snapshot.revision, snapshot.status, snapshot.value, sourceRevision])

  useEffect(() => () => { props.closeModelPicker() }, [props.closeModelPicker])

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
      setLastUsage(read.usage)
      setUsageUpdatedAt(new Date())
      setUsage({ status: 'ready', usage: read.usage })
    } catch (error: unknown) {
      setUsage({ status: 'error', message: messageOf(error, t('usageFailed')) })
    }
  }

  useEffect(() => {
    let cancelled = false
    void readAuthStatus().then((status) => {
      if (cancelled) return
      if (status.loggedIn) {
        setAuth({ kind: 'signed-in', ...status.email === undefined ? {} : { email: status.email } })
        return
      }
      setAuth({ kind: 'signed-out' })
      setLastUsage(undefined)
      setUsageUpdatedAt(undefined)
      setUsage({ status: 'idle' })
    }).catch(() => {
      if (!cancelled) {
        setAuth({ kind: 'signed-out', message: t('statusFailed') })
        setUsage({ status: 'idle' })
      }
    })
    return () => { cancelled = true }
  }, [readAuthStatus, t])

  useEffect(() => {
    if (!open || auth.kind !== 'signed-in') return
    setUsage({ status: 'loading' })
    void loadUsage()
  }, [open, auth.kind])

  const patchDraft = (models: ModelDraft[]): void => {
    setDraft(models)
    setFailure(undefined)
    setNotice(undefined)
  }
  const patchModel = (index: number, patch: ModelPatch): void => {
    if (draft === undefined) return
    patchDraft(draft.map((model, at) => {
      if (at !== index) return model
      const next: ModelDraft = { ...model }
      if (patch.id !== undefined) next.id = patch.id
      if ('name' in patch) {
        if (patch.name === undefined) delete next.name
        else next.name = patch.name
      }
      if ('thinking' in patch) {
        if (patch.thinking === undefined) delete next.thinking
        else next.thinking = patch.thinking
      }
      if ('vision' in patch) {
        if (patch.vision === undefined) delete next.vision
        else next.vision = patch.vision
      }
      if ('defaultReasoningEffort' in patch) {
        if (patch.defaultReasoningEffort === undefined) delete next.defaultReasoningEffort
        else next.defaultReasoningEffort = patch.defaultReasoningEffort
      }
      if ('contextWindow' in patch) next.contextWindow = patch.contextWindow ?? ''
      return next
    }))
  }

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
      setLastUsage(undefined)
      setUsageUpdatedAt(undefined)
      setUsage({ status: 'idle' })
    } catch {
      setAuth(current => current.kind === 'signed-in'
        ? current
        : { kind: 'signed-out', message: t('signOutFailed') })
    }
  }

  const chooseFromAccount = async (): Promise<void> => {
    if (draft === undefined) return
    const currentModels = draft.map(modelSettingsOf)
    const initiallyPicked = new Set(currentModels.map(model => model.id))
    setFetching(true)
    setFailure(undefined)
    setNotice(undefined)
    props.beginModelPicker(initiallyPicked, selected => {
      setDraft((current) => {
        if (current === undefined) return current
        const currentById = new Map(current.map(model => [model.id.trim(), model]))
        const next = new Map<string, ModelDraft>()
        for (const candidate of selected) {
          const existing = currentById.get(candidate.id)
          const discovered = modelDraftOf(candidate)
          next.set(candidate.id, existing === undefined
            ? discovered
            : { ...existing, ...discovered, rowId: existing.rowId })
        }
        return [...next.values()]
      })
      setCatalogOpen(true)
      setFailure(undefined)
      setNotice(undefined)
    })
    try {
      const found = await fetchModels()
      if (found.length === 0) {
        const message = t('fetchEmpty')
        props.failModelPicker(message)
        setFailure(message)
        return
      }
      const foundIds = new Set(found.map(model => model.id))
      const currentOnly = currentModels.filter(model => !foundIds.has(model.id))
      props.completeModelPicker([...found, ...currentOnly])
    } catch (error: unknown) {
      const message = messageOf(error, t('requestFailed'))
      props.failModelPicker(message)
      setFailure(message)
    } finally {
      setFetching(false)
    }
  }

  const discard = (): void => {
    if (source !== undefined) setDraft(source.map(model => ({ ...model })))
    setEnableImageGen(sourceEnableImageGen)
    setFailure(undefined)
    setNotice(undefined)
  }

  const save = async (): Promise<void> => {
    if (draft === undefined || snapshot.value === undefined || invalid) return
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    try {
      const accepted = await props.saveConfiguration({
        ...snapshot.value,
        models: draft.map(modelSettingsOf),
        enableImageGen,
      })
      const next = accepted.settings.models.map(modelDraftOf)
      setSource(next)
      setDraft(next)
      setEnableImageGen(accepted.settings.enableImageGen)
      setSourceEnableImageGen(accepted.settings.enableImageGen)
      setSourceRevision(accepted.revision)
      setNotice(t('saved'))
    } catch (error: unknown) {
      setFailure(messageOf(error, t('requestFailed')))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = signingIn
    ? t('signingIn')
    : auth.kind === 'signed-in'
      ? formatSignedIn(t, auth.email)
      : auth.message ?? t('signedOut')
  const modelCount = draft?.length ?? 0
  const headerSummary = formatProviderSummary(
    auth.kind === 'signed-in' ? t('summaryOn') : t('summaryOff'),
    t('summaryModels').replace('{count}', String(modelCount)),
  )

  if (snapshot.status === 'unavailable') {
    return (
      <li style={cardStyle}>
        <button
          type="button"
          style={headerStyle}
          aria-expanded={open}
          aria-label={t(open ? 'collapse' : 'expand') + ': ' + title}
          onClick={() => { setOpen(!open) }}
        >
          <ProviderCardHeader
            title={title}
            mark={<BrandMark />}
            summary={headerSummary}
            open={open}
          />
        </button>
        {open
          ? (
            <div style={bodyStyle}>
              <p style={statusStyle} role="status">{t('remoteAccess')}</p>
            </div>
          )
          : null}
      </li>
    )
  }

  if (snapshot.status !== 'ready' || draft === undefined) {
    return (
      <li style={cardStyle}>
        <button
          type="button"
          style={headerStyle}
          aria-expanded={open}
          aria-label={t(open ? 'collapse' : 'expand') + ': ' + title}
          onClick={() => { setOpen(!open) }}
        >
          <ProviderCardHeader
            title={title}
            mark={<BrandMark />}
            summary={headerSummary}
            open={open}
          />
        </button>
        {open ? <div style={bodyStyle}><p style={statusStyle}>{t('loading')}</p></div> : null}
      </li>
    )
  }

  return (
    <li style={cardStyle}>
      <button
        type="button"
        style={headerStyle}
        aria-expanded={open}
        aria-label={t(open ? 'collapse' : 'expand') + ': ' + title}
        onClick={() => { setOpen(!open) }}
      >
        <ProviderCardHeader
          title={title}
          mark={<BrandMark />}
          summary={headerSummary}
          open={open}
          unsaved={dirty}
          unsavedLabel={t('unsaved')}
        />
      </button>
      {open
        ? (
          <div style={bodyStyle}>
            <p style={hintStyle}>{t('description')}</p>
            <section style={sectionStyle} aria-label={statusLabel}>
              <AuthToolbar
                status={<p style={{ ...statusStyle, margin: 0 }}>{statusLabel}</p>}
                action={auth.kind === 'signed-in'
                  ? <button type="button" style={buttonStyle} disabled={signingIn} onClick={() => { void onSignOut() }}>{t('signOut')}</button>
                  : <button type="button" style={buttonStyle} disabled={signingIn} onClick={() => { void onSignIn() }}>{t('signIn')}</button>}
              />
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
            </section>
            {auth.kind === 'signed-in'
              ? (
                <section style={sectionStyle} aria-label={t('usage')}>
                  <UsageHeader
                    title={t('usage')}
                    spinning={usage.status === 'loading' || usage.status === 'idle'}
                    disabled={usage.status === 'loading'}
                    refreshLabel={t('usageRefresh')}
                    busyLabel={t('usageLoading')}
                    {...usage.status === 'error' ? { error: t('usageRefreshFailed') } : {}}
                    onRefresh={() => { void loadUsage() }}
                  />
                  {(() => {
                    if (usage.status === 'loading' || usage.status === 'idle') {
                      return <UsageSkeleton rows={lastUsage?.windows.length ?? 1} />
                    }
                    const bars = usage.status === 'ready' ? usage.usage : lastUsage
                    if (bars !== undefined) {
                      return (
                        <>
                          {bars.windows.map((window, index) => (
                            <UsageBar
                              key={window.id + ':' + String(index)}
                              usedText={t('usageUsed')}
                              window={window}
                              t={t}
                            />
                          ))}
                        </>
                      )
                    }
                    if (usage.status === 'unsupported') return <p style={hintStyle}>{t('usageUnsupported')}</p>
                    if (usage.status === 'error') return <p style={errorStyle}>{usage.message}</p>
                    return <UsageSkeleton rows={1} />
                  })()}
                  <UsageUpdatedAt
                    at={usageUpdatedAt}
                    label={usageUpdatedAt === undefined ? '' : t('usageUpdatedAt').replace('{time}', formatUsageClock(usageUpdatedAt))}
                  />
                </section>
              )
              : null}
            <section style={sectionStyle} aria-label={t('models')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <button
                  type="button"
                  style={disclosureStyle}
                  aria-expanded={catalogOpen}
                  aria-label={t('models')}
                  onClick={() => { setCatalogOpen(!catalogOpen) }}
                >
                  <IconChevron open={catalogOpen} />
                  <span style={sectionTitleStyle}>{t('models')}</span>
                  <span style={hintStyle}>{customModels ? t('customized') : t('inherited')}</span>
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={fetching || disabled}
                  onClick={() => { void chooseFromAccount() }}
                >
                  {t(fetching ? 'fetchingModels' : 'fetchModels')}
                </button>
              </div>
              {catalogOpen
                ? (
                  <>
                    <SortableList
                      items={draft}
                      getId={model => model.rowId}
                      disabled={disabled}
                      dragLabel={(model, index) => {
                        const label = model.id.trim().length > 0 ? model.id.trim() : String(index + 1)
                        return t('dragModel') + ': ' + label
                      }}
                      onReorder={patchDraft}
                      renderItem={(model, index) => {
                        const expanded = expandedModels.has(model.rowId)
                        const label = model.id.trim().length > 0 ? model.id.trim() : String(index + 1)
                        return (
                          <div data-model-row={label} style={modelContentStyle}>
                            <input
                              style={rowInputStyle}
                              value={model.id}
                              placeholder={t('modelId')}
                              aria-label={t('modelId') + ' ' + String(index + 1)}
                              disabled={disabled}
                              onChange={(event) => { patchModel(index, { id: event.target.value }) }}
                            />
                            <input
                              style={rowInputStyle}
                              value={model.name ?? ''}
                              placeholder={t('modelName')}
                              aria-label={t('modelName') + ' ' + String(index + 1)}
                              disabled={disabled}
                              onChange={(event) => { patchModel(index, { name: event.target.value || undefined }) }}
                            />
                            <button
                              type="button"
                              style={iconButtonStyle}
                              aria-label={t('modelDetails') + ': ' + label}
                              aria-expanded={expanded}
                              title={t('modelDetails')}
                              onClick={() => {
                                setExpandedModels((current) => {
                                  const next = new Set(current)
                                  if (!next.delete(model.rowId)) next.add(model.rowId)
                                  return next
                                })
                              }}
                            >
                              <IconChevron open={expanded} />
                            </button>
                            <button
                              type="button"
                              style={iconButtonStyle}
                              aria-label={t('remove') + ' ' + label}
                              title={t('remove')}
                              disabled={disabled}
                              onClick={() => { patchDraft(draft.filter((_, at) => at !== index)) }}
                            >
                              <IconTrash />
                            </button>
                            {expanded
                              ? (
                                <div style={{ ...modelDetailStyle, gridColumn: '1 / -1' }}>
                                  <Capability
                                    label={t('vision')}
                                    checked={model.vision === true}
                                    disabled={disabled}
                                    onChange={(vision) => { patchModel(index, { vision }) }}
                                  />
                                  <Capability
                                    label={t('thinking')}
                                    checked={model.thinking === true}
                                    disabled={disabled}
                                    onChange={(thinking) => {
                                      if (!thinking) patchModel(index, { thinking, defaultReasoningEffort: undefined })
                                      else patchModel(index, { thinking })
                                    }}
                                  />
                                  {(() => {
                                    const settings = modelSettingsOf(model)
                                    const efforts = settings.thinking === true ? officialEffortsFor(settings) : []
                                    if (efforts.length === 0) return null
                                    const suggested = officialDefaultEffort(settings)
                                    return (
                                      <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        {t('defaultEffort')}
                                        <select
                                          style={rowInputStyle}
                                          value={model.defaultReasoningEffort ?? suggested}
                                          disabled={disabled}
                                          aria-label={t('defaultEffort')}
                                          onChange={(event) => {
                                            const effort = efforts.find(entry => entry.value === event.target.value)
                                            patchModel(index, { defaultReasoningEffort: effort?.value })
                                          }}
                                        >
                                          {efforts.map(effort => (
                                            <option key={effort.value} value={effort.value}>{effort.label ?? effort.value}</option>
                                          ))}
                                        </select>
                                      </label>
                                    )
                                  })()}
                                  <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    {t('contextWindow')}
                                    <input
                                      style={{ ...rowInputStyle, width: 110 }}
                                      inputMode="numeric"
                                      placeholder={t('contextWindowDefault')}
                                      value={model.contextWindow}
                                      disabled={disabled}
                                      aria-label={t('contextWindow')}
                                      onChange={(event) => { patchModel(index, { contextWindow: event.target.value }) }}
                                    />
                                  </label>
                                </div>
                              )
                              : null}
                          </div>
                        )
                      }}
                    />
                    <button
                      type="button"
                      style={{ ...buttonStyle, alignSelf: 'flex-start' }}
                      disabled={disabled}
                      onClick={() => {
                        const model: ModelDraft = { rowId: newModelRowId(), id: '', contextWindow: '' }
                        patchDraft([...draft, model])
                        setExpandedModels(current => new Set(current).add(model.rowId))
                      }}
                    >
                      {t('addModel')}
                    </button>
                  </>
                )
                : null}
            </section>
            <section style={sectionStyle} aria-label={t('capabilities')}>
              <p style={sectionTitleStyle}>{t('capabilities')}</p>
              <Capability
                label={t('enableImageGen')}
                checked={enableImageGen}
                disabled={disabled}
                onChange={(checked) => {
                  setEnableImageGen(checked)
                  setFailure(undefined)
                  setNotice(undefined)
                }}
              />
              <p style={hintStyle}>{t('enableImageGenHelp')}</p>
            </section>
            {invalid ? <p style={errorStyle}>{t('invalidModel')}</p> : null}
            {failure === undefined ? null : <p style={errorStyle}>{failure}</p>}
            {notice === undefined ? null : <p style={statusStyle}>{notice}</p>}
            <div style={actionsStyle}>
              <button type="button" style={buttonStyle} disabled={!dirty || busy} onClick={discard}>{t('discard')}</button>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={!dirty || invalid || disabled}
                onClick={() => { void save() }}
              >
                {t(busy ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
