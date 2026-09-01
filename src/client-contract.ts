/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */

/** Settings namespace owned by the Grok plugin. */
export const GROK_SETTINGS_NAMESPACE = 'llm-grok'
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
export const GROK_PROVIDER = 'grok'
/** Default maximum idle interval while a stream read is outstanding. */
export const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Private Connection RPC channel used by this package's Host and Web faces. */
export const GROK_RPC_CHANNEL = '/grok'
/** Begin a Host-owned PKCE sign-in against auth.x.ai. */
export const GROK_AUTH_START_ENDPOINT = 'auth/start'
/** Secret-free login snapshot. */
export const GROK_AUTH_STATUS_ENDPOINT = 'auth/status'
/** Read one secret-free in-flight authorization attempt status. */
export const GROK_AUTH_ATTEMPT_STATUS_ENDPOINT = 'auth/attempt-status'
/** Delete the Host session file. */
export const GROK_AUTH_LOGOUT_ENDPOINT = 'auth/logout'
/** Deliver a Grok Build paste-code into the in-flight PKCE exchange. */
export const GROK_AUTH_COMPLETE_ENDPOINT = 'auth/complete'
/** Cancel one pending Host-owned authorization attempt. */
export const GROK_AUTH_CANCEL_ENDPOINT = 'auth/cancel'
/** Secret-free subscription-usage snapshot inside {@link GROK_RPC_CHANNEL}. */
export const GROK_USAGE_ENDPOINT = 'usage/read'

/** One official models-v2 reasoning menu row (`id` → wire `value`). */
export interface GrokReasoningEffort {
  /** Menu option id accepted by `/effort` and `--effort`. */
  id: string
  /** Value written to Responses `reasoning.effort`. */
  value: string
  /** Official menu label (`Extra High Effort`, …). */
  label?: string
  /** Official menu description. */
  description?: string
}

/** One model in the plugin's frozen catalog. */
export interface GrokCatalogModel {
  /** Wire model id accepted by the chat proxy. */
  id: string
  /** Selector label; omission uses {@link id}. */
  name?: string
  /** Optional selector detail. */
  description?: string
  /** Known combined request and response context capacity. */
  contextWindow?: number
  /** Per-request output cap for this model. */
  maxTokens?: number
  /** Whether the model supports native thinking. */
  thinking?: boolean
  /** Official advertised reasoning menu; omission uses the frozen per-id list. */
  reasoningEfforts?: readonly GrokReasoningEffort[]
  /** Official default `reasoning.effort` (`reasoning_effort` on models-v2). */
  defaultReasoningEffort?: string
  /** Whether the model accepts image input. */
  vision?: boolean
  /** Whether the model supports tool calls. */
  tools?: boolean
}

/**
 * Offline fallback when the account catalog cannot be read. Live ids come
 * from GET /v1/models-v2 after sign-in.
 */
const GROK_4_6_EFFORTS: readonly GrokReasoningEffort[] = Object.freeze([
  Object.freeze({
    id: 'xhigh',
    value: 'xhigh',
    label: 'Extra High Effort',
    description: 'Highest effort and reasoning level',
  }),
  Object.freeze({
    id: 'high',
    value: 'high',
    label: 'High Effort',
    description: 'Higher implementation quality with extensive reasoning',
  }),
  Object.freeze({
    id: 'medium',
    value: 'medium',
    label: 'Medium Effort',
    description: 'Balanced effort with standard implementation and testing',
  }),
  Object.freeze({
    id: 'low',
    value: 'low',
    label: 'Low Effort',
    description: 'Quick, fast implementations',
  }),
])

export const GROK_CATALOG: readonly GrokCatalogModel[] = Object.freeze([
  Object.freeze({
    id: 'grok-4.6',
    name: 'Grok 4.6',
    thinking: true,
    vision: true,
    contextWindow: 500_000,
    defaultReasoningEffort: 'high',
    reasoningEfforts: GROK_4_6_EFFORTS,
  }),
  Object.freeze({
    id: 'grok-4.5',
    name: 'Grok 4.5',
    thinking: true,
    vision: true,
    contextWindow: 500_000,
    defaultReasoningEffort: 'high',
    reasoningEfforts: Object.freeze(GROK_4_6_EFFORTS.filter(effort => effort.value !== 'xhigh')),
  }),
])
/** Account model list inside {@link GROK_RPC_CHANNEL}. */
export const GROK_MODELS_ENDPOINT = 'models/list'
/** Read the redacted Grok settings snapshot through the management RPC. */
export const GROK_SETTINGS_READ_ENDPOINT = 'settings/read'
/** Atomic settings-save endpoint. */
export const GROK_SAVE_ENDPOINT = 'settings/save'

/** Settings fields presented by the package's Web configuration card. No apiKeyEnv. */
export interface GrokSettingsView {
  /** Stream idle timeout in milliseconds. */
  streamIdleTimeoutMs: number
  /** Displayed advisory catalog (a subset of the account catalog). */
  models: GrokCatalogModel[]
  /** When true, register the `grok_image_gen` tool. */
  enableImageGen: boolean
}

/** Atomic editable-settings payload sent by the browser face. */
export interface GrokSaveRequest {
  /** Complete displayed catalog currently shown by the editor. */
  models: GrokCatalogModel[]
  /** Optional `grok_image_gen` enablement; omission leaves the current value. */
  enableImageGen?: boolean
  /** Settings descriptor revision from which the editor began. */
  expectedRevision: number
}

/** Accepted settings snapshot after one Host mutation. */
export interface GrokSaveResult {
  settings: GrokSettingsView
  revision: number
}

/** Redacted settings snapshot returned by the management read endpoint. */
export interface GrokSettingsReadResult {
  settings: GrokSettingsView
  revision: number
}

/** Secret-free login snapshot returned by {@link GROK_AUTH_STATUS_ENDPOINT}. */
export type GrokAuthAttemptState = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

/** Secret-free terminal state for one authorization attempt. */
export interface GrokAuthAttemptStatus {
  attemptId: string
  state: GrokAuthAttemptState
}

export interface GrokAuthStatus {
  /** Whether the Host currently holds a usable session file. */
  loggedIn: boolean
  /** Account email when the session recorded one. */
  email?: string
  /** ISO-8601 access-token expiry when the session recorded one. */
  expiresAt?: string
}

/**
 * Result of {@link GROK_AUTH_START_ENDPOINT}. Cancel, timeout, and state
 * mismatch are retryable failures, not internal errors.
 */
export type GrokAuthStartReply =
  | { ok: true, attemptId?: string, authorizationUrl?: string, popupBlocked?: boolean }
  | { ok: false, retryable: true, message: string }

/** Loopback payload for {@link GROK_AUTH_COMPLETE_ENDPOINT}. */
export interface GrokAuthAttemptStatusRequest {
  attemptId: string
}

export interface GrokAuthCompleteRequest {
  /** Short-lived authorization code copied from the IdP page. Not a token. */
  code: string
  /** Opaque Host transaction id. */
  attemptId?: string
}

/** Result of {@link GROK_AUTH_LOGOUT_ENDPOINT}. */
export interface GrokAuthLogoutReply {
  /** Logout always reports success after the session file is gone. */
  ok: true
}

/** One metered quota window decoded from the Host billing snapshot. */
export interface GrokUsageWindow {
  /** Stable window id shown as the meter label (`monthly`, `weekly`, …). */
  id: string
  /** Consumed amount in the window. */
  used: number
  /** Window ceiling. */
  limit: number
  /** Optional period label from the billing payload (`month`, `week`, …). */
  period?: string
  /** When `percent`, the card shows used as a 0–100 percentage. */
  unit?: 'percent'
  /** ISO-8601 instant the official dashboard calls 重置时间 / reset time. */
  resetsAt?: string
}

/** Secret-free usage snapshot the configuration card renders. */
export interface GrokUsageView {
  /** ISO-8601 time the Host read the snapshot. */
  fetchedAt: string
  /** Decoded windows, provider order, at least one entry. */
  windows: GrokUsageWindow[]
}

/**
 * Usage answer crossing the plugin RPC. Logged-out and unsupported are
 * legitimate answers, not transport failures, so they ride the success
 * branch instead of an error code.
 */
export interface GrokModelsReply {
  /** Models the signed-in account can use, provider order. */
  models: GrokCatalogModel[]
}

export type GrokUsageReply =
  | { status: 'ok', usage: GrokUsageView }
  | { status: 'unsupported' }
  | { status: 'logged-out' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TOKEN_FIELD = /^(?:accessToken|refreshToken|access_token|refresh_token|id_token|idToken|token)$/iu

function hasTokenFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).some(key => TOKEN_FIELD.test(key))
}

function optionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0)
}

/**
 * Narrow the schema-resolved settings section before it enters React state.
 * @param value - untrusted settings response value.
 * @returns the validated settings view, or undefined when the response is invalid.
 */
export function decodeGrokSettings(value: unknown): GrokSettingsView | undefined {
  if (!isRecord(value)) return undefined
  const streamIdleTimeoutMs = value['streamIdleTimeoutMs']
  if (typeof streamIdleTimeoutMs !== 'number' || !Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) {
    return undefined
  }
  const modelsValue = value['models']
  const enableImageGen = value['enableImageGen'] === true
  if (modelsValue === undefined) {
    return { streamIdleTimeoutMs, models: GROK_CATALOG.map(model => ({ ...model })), enableImageGen }
  }
  if (!Array.isArray(modelsValue)) return undefined
  const models: GrokCatalogModel[] = []
  for (const entry of modelsValue) {
    const model = decodeGrokCatalogModel(entry)
    if (model === undefined) return undefined
    models.push(model)
  }
  return { streamIdleTimeoutMs, models, enableImageGen }
}

/**
 * Narrow an empty auth RPC payload. Token-shaped fields are rejected so a
 * confused caller cannot push secrets across the authenticated Host Connection.
 * @param value - untrusted RPC request payload.
 * @returns an empty object, or undefined when the payload is invalid.
 */
/**
 * Narrow a paste-code completion request. The value is an authorization code,
 * not an access token; token-shaped field names are still rejected.
 * @param value - untrusted RPC request payload.
 */
export function decodeGrokAuthCompleteRequest(value: unknown): GrokAuthCompleteRequest | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const code = value['code']
  const attemptId = value['attemptId']
  if (typeof code !== 'string' || code.trim().length === 0) return undefined
  if (attemptId !== undefined && (typeof attemptId !== 'string' || attemptId.trim().length === 0)) return undefined
  return { code: code.trim(), ...attemptId === undefined ? {} : { attemptId: attemptId.trim() } }
}

export function decodeGrokEmptyRequest(value: unknown): Record<string, never> | undefined {
  if (value === undefined || value === null) return {}
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  return {}
}

/**
 * Narrow the Host start-login reply before the card updates.
 * @param value - untrusted RPC result value.
 * @returns the validated reply, or undefined when it is malformed or carries secrets.
 */
export function decodeGrokAuthStartReply(value: unknown): GrokAuthStartReply | undefined {
  if (!isRecord(value) || hasTokenFields(value) || typeof value['ok'] !== 'boolean') return undefined
  if (value['ok'] === true) {
    const attemptId = value['attemptId']
    const authorizationUrl = value['authorizationUrl']
    if (attemptId !== undefined && (typeof attemptId !== 'string' || attemptId.length === 0)) return undefined
    if (authorizationUrl !== undefined && (typeof authorizationUrl !== 'string' || !authorizationUrl.startsWith('https://'))) return undefined
    const popupBlocked = value['popupBlocked']
    if (popupBlocked !== undefined && typeof popupBlocked !== 'boolean') return undefined
    return { ok: true, ...attemptId === undefined ? {} : { attemptId }, ...authorizationUrl === undefined ? {} : { authorizationUrl }, ...popupBlocked === undefined ? {} : { popupBlocked } }
  }
  if (value['retryable'] !== true || typeof value['message'] !== 'string' || value['message'].length === 0) {
    return undefined
  }
  return { ok: false, retryable: true, message: value['message'] }
}

/**
 * Narrow the secret-free login snapshot. Token-shaped fields fail closed.
 * @param value - untrusted RPC result value.
 * @returns the validated status, or undefined when it is malformed or carries secrets.
 */
export function decodeGrokAuthAttemptStatus(value: unknown): GrokAuthAttemptStatus | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const attemptId = value['attemptId']
  const state = value['state']
  if (typeof attemptId !== 'string' || attemptId.length === 0) return undefined
  if (state !== 'pending' && state !== 'succeeded' && state !== 'failed' && state !== 'cancelled' && state !== 'expired') return undefined
  return { attemptId, state }
}

export function decodeGrokAuthStatus(value: unknown): GrokAuthStatus | undefined {
  if (!isRecord(value) || hasTokenFields(value) || typeof value['loggedIn'] !== 'boolean') return undefined
  const email = value['email']
  const expiresAt = value['expiresAt']
  if (!optionalNonEmptyString(email) || !optionalNonEmptyString(expiresAt)) return undefined
  return {
    loggedIn: value['loggedIn'],
    ...email === undefined ? {} : { email },
    ...expiresAt === undefined ? {} : { expiresAt },
  }
}

/**
 * Narrow the logout reply.
 * @param value - untrusted RPC result value.
 * @returns the validated reply, or undefined when it is malformed or carries secrets.
 */
export function decodeGrokAuthLogoutReply(value: unknown): GrokAuthLogoutReply | undefined {
  if (!isRecord(value) || hasTokenFields(value) || value['ok'] !== true) return undefined
  return { ok: true }
}

function decodeGrokUsageWindow(value: unknown): GrokUsageWindow | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const id = value['id']
  const used = value['used']
  const limit = value['limit']
  const period = value['period']
  const unit = value['unit']
  const resetsAt = value['resetsAt']
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return undefined
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return undefined
  if (!optionalNonEmptyString(period)) return undefined
  if (unit !== undefined && unit !== 'percent') return undefined
  if (!optionalNonEmptyString(resetsAt)) return undefined
  return {
    id,
    used,
    limit,
    ...period === undefined ? {} : { period },
    ...unit === undefined ? {} : { unit },
    ...resetsAt === undefined ? {} : { resetsAt },
  }
}

/**
 * Narrow one usage snapshot.
 * @param value - untrusted JSON value.
 * @returns the validated snapshot, or undefined when it is malformed or carries secrets.
 */
export function decodeGrokUsageView(value: unknown): GrokUsageView | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  if (typeof value['fetchedAt'] !== 'string' || value['fetchedAt'].length === 0) return undefined
  if (!Array.isArray(value['windows']) || value['windows'].length === 0) return undefined
  const windows: GrokUsageWindow[] = []
  for (const entry of value['windows']) {
    const decoded = decodeGrokUsageWindow(entry)
    if (decoded === undefined) return undefined
    windows.push(decoded)
  }
  return { fetchedAt: value['fetchedAt'], windows }
}

/**
 * Narrow the usage reply returned by the Host usage endpoint.
 * @param value - untrusted RPC result value.
 * @returns the validated reply, or undefined when it is malformed or carries secrets.
 */
function decodeGrokReasoningEffort(value: unknown): GrokReasoningEffort | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const id = value['id']
  const wire = value['value']
  const label = value['label']
  const description = value['description']
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (typeof wire !== 'string' || wire.length === 0) return undefined
  if (label !== undefined && (typeof label !== 'string' || label.length === 0)) return undefined
  if (description !== undefined && (typeof description !== 'string' || description.length === 0)) {
    return undefined
  }
  return {
    id,
    value: wire,
    ...label === undefined ? {} : { label },
    ...description === undefined ? {} : { description },
  }
}

export function decodeGrokCatalogModel(value: unknown): GrokCatalogModel | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const id = value['id']
  const name = value['name']
  const thinking = value['thinking']
  const vision = value['vision']
  const contextWindow = value['contextWindow']
  const defaultReasoningEffort = value['defaultReasoningEffort']
  const reasoningEffortsValue = value['reasoningEfforts']
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (name !== undefined && (typeof name !== 'string' || name.length === 0)) return undefined
  if (thinking !== undefined && typeof thinking !== 'boolean') return undefined
  if (vision !== undefined && typeof vision !== 'boolean') return undefined
  if (contextWindow !== undefined && (
    typeof contextWindow !== 'number'
    || !Number.isInteger(contextWindow)
    || contextWindow <= 0
  )) return undefined
  if (defaultReasoningEffort !== undefined
    && (typeof defaultReasoningEffort !== 'string' || defaultReasoningEffort.length === 0)) {
    return undefined
  }
  let reasoningEfforts: GrokReasoningEffort[] | undefined
  if (reasoningEffortsValue !== undefined) {
    if (!Array.isArray(reasoningEffortsValue)) return undefined
    reasoningEfforts = []
    for (const entry of reasoningEffortsValue) {
      const effort = decodeGrokReasoningEffort(entry)
      if (effort === undefined) return undefined
      reasoningEfforts.push(effort)
    }
  }
  return {
    id,
    ...name === undefined ? {} : { name },
    ...thinking === undefined ? {} : { thinking },
    ...vision === undefined ? {} : { vision },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
  }
}

export function decodeGrokModelsReply(value: unknown): GrokModelsReply | undefined {
  if (!isRecord(value) || hasTokenFields(value) || !Array.isArray(value['models'])) return undefined
  const models: GrokCatalogModel[] = []
  for (const entry of value['models']) {
    const model = decodeGrokCatalogModel(entry)
    if (model === undefined) return undefined
    models.push(model)
  }
  return { models }
}

/**
 * Narrow an atomic catalog-save request. Token-shaped fields fail closed.
 * @param value - untrusted RPC request payload.
 */
export function decodeGrokSaveRequest(value: unknown): GrokSaveRequest | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const expectedRevision = value['expectedRevision']
  if (!Array.isArray(value['models']) || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)) {
    return undefined
  }
  if (value['enableImageGen'] !== undefined && typeof value['enableImageGen'] !== 'boolean') return undefined
  const models: GrokCatalogModel[] = []
  for (const entry of value['models']) {
    const model = decodeGrokCatalogModel(entry)
    if (model === undefined) return undefined
    models.push(model)
  }
  return {
    models,
    expectedRevision,
    ...typeof value['enableImageGen'] === 'boolean' ? { enableImageGen: value['enableImageGen'] } : {},
  }
}

/**
 * Narrow the Host save reply before the card updates.
 * @param value - untrusted RPC result value.
 */
/** Decode a redacted settings snapshot and its revision. */
export function decodeGrokSettingsReadResult(value: unknown): GrokSettingsReadResult | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const revision = value['revision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) return undefined
  const settings = decodeGrokSettings(value['settings'])
  return settings === undefined ? undefined : { settings, revision }
}

export function decodeGrokSaveResult(value: unknown): GrokSaveResult | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  const revision = value['revision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) return undefined
  const settings = decodeGrokSettings(value['settings'])
  return settings === undefined ? undefined : { settings, revision }
}

export function decodeGrokUsageReply(value: unknown): GrokUsageReply | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  if (value['status'] === 'unsupported') return { status: 'unsupported' }
  if (value['status'] === 'logged-out') return { status: 'logged-out' }
  if (value['status'] !== 'ok') return undefined
  const usage = decodeGrokUsageView(value['usage'])
  return usage === undefined ? undefined : { status: 'ok', usage }
}
