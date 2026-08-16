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
/** Delete the Host session file. */
export const GROK_AUTH_LOGOUT_ENDPOINT = 'auth/logout'
/** Deliver a Grok Build paste-code into the in-flight PKCE exchange. */
export const GROK_AUTH_COMPLETE_ENDPOINT = 'auth/complete'
/** Secret-free subscription-usage snapshot inside {@link GROK_RPC_CHANNEL}. */
export const GROK_USAGE_ENDPOINT = 'usage/read'

/** One model in the plugin's frozen catalog. */
export interface GrokCatalogModel {
  /** Wire model id accepted by the chat proxy. */
  id: string
  /** Whether the model supports native thinking. */
  thinking?: boolean
  /** Whether the model accepts image input. */
  vision?: boolean
}

/**
 * Source-frozen advisory catalog. V1 does not fetch an account directory;
 * later tickets may append ids to this constant only.
 */
export const GROK_CATALOG: readonly GrokCatalogModel[] = Object.freeze([
  Object.freeze({ id: 'grok-4.6', thinking: true, vision: true }),
])

/** Settings fields presented by the package's Web configuration card. No apiKeyEnv. */
export interface GrokSettingsView {
  /** Stream idle timeout in milliseconds. */
  streamIdleTimeoutMs: number
}

/** Secret-free login snapshot returned by {@link GROK_AUTH_STATUS_ENDPOINT}. */
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
  | { ok: true }
  | { ok: false, retryable: true, message: string }

/** Loopback payload for {@link GROK_AUTH_COMPLETE_ENDPOINT}. */
export interface GrokAuthCompleteRequest {
  /** Short-lived authorization code copied from the IdP page. Not a token. */
  code: string
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
  return { streamIdleTimeoutMs }
}

/**
 * Narrow an empty auth RPC payload. Token-shaped fields are rejected so a
 * confused caller cannot push secrets across the loopback channel.
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
  if (typeof code !== 'string' || code.trim().length === 0) return undefined
  return { code: code.trim() }
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
  if (value['ok'] === true) return { ok: true }
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
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return undefined
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return undefined
  if (!optionalNonEmptyString(period)) return undefined
  return {
    id,
    used,
    limit,
    ...period === undefined ? {} : { period },
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
export function decodeGrokUsageReply(value: unknown): GrokUsageReply | undefined {
  if (!isRecord(value) || hasTokenFields(value)) return undefined
  if (value['status'] === 'unsupported') return { status: 'unsupported' }
  if (value['status'] === 'logged-out') return { status: 'logged-out' }
  if (value['status'] !== 'ok') return undefined
  const usage = decodeGrokUsageView(value['usage'])
  return usage === undefined ? undefined : { status: 'ok', usage }
}
