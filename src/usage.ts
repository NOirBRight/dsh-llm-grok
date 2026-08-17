/**
 * Reading the account's Grok subscription quota for the configuration card.
 *
 * The Host calls `GET …/v1/billing?format=credits` with the stored access
 * token. The browser only receives the decoded window view.
 *
 * A missing or unrecognized billing surface is `unsupported`, not a failure:
 * usage is advisory information, never a blocker.
 *
 * @module dsh-llm-grok/usage
 */

import type { GrokUsageView, GrokUsageWindow } from './client-contract.ts'

import { GROK_CLI_REQUEST_HEADERS } from './cli-identity.ts'

/** SuperGrok quota lives on the credits flavor, not the prepaid 0/0 envelope. */
export const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

/** Per-read budget for one billing request. */
export const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 15_000

/** Replies larger than this are refused; a healthy billing reply is a few KiB. */
const MAX_USAGE_BYTES = 1024 * 1024

/** Documented billing JSON: `windows` with `id`, `used`, `limit`, optional `period`. */
interface WireBillingResponse {
  windows?: unknown
}

/** One Host billing read: stored access token plus test overrides. */
export interface GrokUsageRequest {
  /** Current session access token. Never forwarded to the browser. */
  accessToken: string
  /** Override the production billing URL (local fake server). */
  billingURL?: string
  /** Fetch implementation; production uses global fetch. */
  fetch?: typeof fetch
  /** Clock used for {@link GrokUsageView.fetchedAt}. */
  now?: () => number
  /** Caller cancellation. */
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redactSecrets(message: string, secrets: readonly string[]): string {
  let next = message
  for (const secret of secrets) {
    if (secret.length === 0) continue
    next = next.split(secret).join('[redacted]')
  }
  return next
}

function parseWindow(value: unknown): GrokUsageWindow | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const used = value['used']
  const limit = value['limit']
  const period = value['period']
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return undefined
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return undefined
  if (period !== undefined && (typeof period !== 'string' || period.length === 0)) return undefined
  return {
    id,
    used,
    limit,
    ...period === undefined ? {} : { period },
  }
}

/** cli-chat-proxy wraps money-like amounts as `{ val: number }`. */
function moneyVal(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (!isRecord(value)) return undefined
  const val = value['val']
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return undefined
  return val
}

function periodFromConfig(config: Record<string, unknown>): string | undefined {
  const current = isRecord(config['currentPeriod']) ? config['currentPeriod'] : undefined
  const start = (current?.['start'] ?? config['billingPeriodStart'])
  const end = (current?.['end'] ?? config['billingPeriodEnd'])
  if (typeof start !== 'string' || start.length === 0) return undefined
  if (typeof end !== 'string' || end.length === 0) return start.slice(0, 10)
  return `${start.slice(0, 10)} – ${end.slice(0, 10)}`
}

function percentWindow(id: string, percent: number, period: string | undefined): GrokUsageWindow {
  // Official grok.com usage shows 1% when the wire value is 1.0 — the scale is
  // already percent points, not a 0–1 fraction.
  const used = Math.min(100, Math.max(0, Math.round(percent * 10) / 10))
  return {
    id,
    used,
    limit: 100,
    unit: 'percent',
    ...period === undefined ? {} : { period },
  }
}

/** Credits flavor: weekly window + per-product usagePercent (0–1). */
function parseCreditsConfig(config: Record<string, unknown>, fetchedAt: string): GrokUsageView | undefined {
  const period = periodFromConfig(config)
  const windows: GrokUsageWindow[] = []
  const products = config['productUsage']
  if (Array.isArray(products)) {
    for (const entry of products) {
      if (!isRecord(entry)) continue
      const product = entry['product']
      const percent = entry['usagePercent']
      if (typeof product !== 'string' || product.length === 0) continue
      if (typeof percent !== 'number' || !Number.isFinite(percent)) continue
      windows.push(percentWindow(product, percent, period))
    }
  }
  if (windows.length === 0) {
    const percent = config['creditUsagePercent']
    if (typeof percent === 'number' && Number.isFinite(percent)) {
      windows.push(percentWindow('weekly', percent, period))
    }
  }
  return windows.length === 0 ? undefined : { fetchedAt, windows }
}

/** Prepaid envelope: `{ config: { monthlyLimit, used } }` — SuperGrok is usually 0/0 here. */
function parsePrepaidConfig(config: Record<string, unknown>, fetchedAt: string): GrokUsageView | undefined {
  const used = moneyVal(config['used'])
  const limit = moneyVal(config['monthlyLimit'])
  if (used === undefined || limit === undefined) return undefined
  if (used === 0 && limit === 0) return undefined
  const period = periodFromConfig(config)
  return {
    fetchedAt,
    windows: [{
      id: 'monthly',
      used,
      limit,
      ...period === undefined ? {} : { period },
    }],
  }
}

function parseCliBillingConfig(value: unknown, fetchedAt: string): GrokUsageView | undefined {
  if (!isRecord(value)) return undefined
  const config = value['config']
  if (!isRecord(config)) return undefined
  return parseCreditsConfig(config, fetchedAt) ?? parsePrepaidConfig(config, fetchedAt)
}

/**
 * Convert the proxy billing JSON into the secret-free snapshot the card renders.
 * Unknown bodies and windows that cannot be read return undefined (unsupported).
 * @param value - opaque JSON returned by the billing endpoint.
 * @param fetchedAt - ISO-8601 instant the Host read the body.
 */
export function parseGrokBilling(value: unknown, fetchedAt: string): GrokUsageView | undefined {
  const fromConfig = parseCliBillingConfig(value, fetchedAt)
  if (fromConfig !== undefined) return fromConfig
  const windowsValue = isRecord(value) ? (value as WireBillingResponse).windows : undefined
  if (!Array.isArray(windowsValue)) return undefined
  const windows: GrokUsageWindow[] = []
  for (const entry of windowsValue) {
    const window = parseWindow(entry)
    if (window !== undefined) windows.push(window)
  }
  if (windows.length === 0) return undefined
  return { fetchedAt, windows }
}

/**
 * Read the account's current billing windows with a Host-held access token.
 * 404 and unrecognized JSON are `unsupported`. Transport failures throw a
 * message that never includes the token.
 * @param request - access token and optional test overrides.
 */
export async function readGrokUsage(
  request: GrokUsageRequest,
): Promise<{ status: 'ok', usage: GrokUsageView } | { status: 'unsupported' }> {
  const url = request.billingURL ?? GROK_BILLING_URL
  const fetchImpl = request.fetch ?? fetch
  const fetchedAt = new Date((request.now ?? Date.now)()).toISOString()
  const timeout = AbortSignal.timeout(DEFAULT_USAGE_REQUEST_TIMEOUT_MS)
  const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout])
  const secrets = [request.accessToken]

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${request.accessToken}`,
        ...GROK_CLI_REQUEST_HEADERS,
      },
      // The request carries the credential; a redirect would forward it.
      redirect: 'error',
      signal,
    })
  } catch (error: unknown) {
    if (request.signal?.aborted === true) {
      throw new Error(redactSecrets('Grok usage read aborted by caller', secrets))
    }
    const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : ''
    throw new Error(redactSecrets(`could not reach ${url}${detail}`, secrets))
  }
  if (response.status === 404) {
    await response.body?.cancel()
    return { status: 'unsupported' }
  }
  if (response.status === 403) {
    await response.body?.cancel()
    throw new Error('This session cannot read Grok CLI billing. Sign out and sign in again.')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(redactSecrets(`${url} answered ${String(response.status)}`, secrets))
  }
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_USAGE_BYTES) {
    await response.body?.cancel()
    throw new Error(redactSecrets(`${url} answered with more than ${String(MAX_USAGE_BYTES)} bytes`, secrets))
  }
  let text: string
  try {
    text = await response.text()
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : ''
    throw new Error(redactSecrets(`${url} could not be read${detail}`, secrets))
  }
  if (text.length > MAX_USAGE_BYTES) {
    throw new Error(redactSecrets(`${url} answered with more than ${String(MAX_USAGE_BYTES)} bytes`, secrets))
  }
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return { status: 'unsupported' }
  }
  const usage = parseGrokBilling(body, fetchedAt)
  return usage === undefined ? { status: 'unsupported' } : { status: 'ok', usage }
}
