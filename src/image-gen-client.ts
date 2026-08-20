/**
 * Isolated Imagine REST client. Uses the Grok subscription access token
 * against api.x.ai, matching Grok Build's ImageGenClient — not cli-chat-proxy.
 */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { GROK_CLI_REQUEST_HEADERS } from './cli-identity.ts'
import { mediaTypeOf } from './image-bytes.ts'
import { GROK_PLUGIN_IDENTITY_HEADER } from './pi-ai-profile.ts'

/** Official Imagine REST base, including `/v1`. */
export const GROK_IMAGINE_BASE_URL = 'https://api.x.ai/v1'
/** Default Imagine model used by Grok Build quality generations. */
export const GROK_IMAGINE_MODEL = 'grok-imagine-image-quality'
/** Aspect ratios the Grok Build `image_gen` skill documents. */
export const GROK_IMAGINE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20',
  'auto',
] as const
/** One allowed `aspect_ratio` value. */
export type GrokImagineAspectRatio = (typeof GROK_IMAGINE_ASPECT_RATIOS)[number]
/** Default idle bound for one Imagine POST. First-party chat idle is five minutes; Imagine 1K bodies are slower than chat tokens. */
export const GROK_IMAGE_GEN_TIMEOUT_MS = 300_000
/** Extra Imagine POSTs after a dropped body / transport error. */
export const GROK_IMAGE_GEN_TRANSPORT_RETRIES = 1

/** Inputs for one text-to-image call. */
export interface GenerateGrokImageRequest {
  /** Bearer access token from the Host Grok session. */
  accessToken: string
  /** Image prompt, already trimmed. */
  prompt: string
  /** Optional Imagine aspect ratio. */
  aspectRatio?: GrokImagineAspectRatio
  /** Caller cancellation. */
  signal?: AbortSignal
  /** Override `fetch` in tests. */
  fetchImpl?: typeof fetch
  /** Override `{base}/images/generations` in tests. */
  imagesURL?: string
  /** Override the default request timeout. */
  timeoutMs?: number
}

/** Decoded raster from one Imagine generation. */
export interface GeneratedGrokImage {
  /** Encoded image bytes. */
  bytes: Uint8Array
  /** Sniffed media type. */
  mediaType: ImageMediaType
  /** Provider-revised prompt when the API returned one. */
  revisedPrompt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redact(message: string, secret: string): string {
  return secret.length === 0 ? message : message.split(secret).join('[redacted]')
}

function fail(message: string, secret: string): never {
  throw new Error(redact(message, secret))
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'network error'
}

function isTransportDrop(error: unknown): boolean {
  return /\bterminated\b|premature close|ECONNRESET|ECONNABORTED|other side closed|fetch failed/i.test(errorMessage(error))
}

function describeNetworkFailure(
  error: unknown,
  user: AbortSignal | undefined,
  timeout: AbortSignal,
  timeoutMs: number,
): string {
  if (user?.aborted) return 'Grok Imagine request was cancelled'
  if (timeout.aborted) return 'Grok Imagine timed out after ' + String(timeoutMs / 1000) + 's'
  if (isTransportDrop(error)) {
    return 'Grok Imagine connection dropped while reading the image (undici: terminated)'
  }
  return 'Grok Imagine request failed: ' + errorMessage(error)
}

function combineSignals(
  user: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal, timeout: AbortSignal, dispose: () => void } {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (user === undefined) return { signal: timeout, timeout, dispose: () => undefined }
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([user, timeout]), timeout, dispose: () => undefined }
  }
  const controller = new AbortController()
  const onAbort = (): void => {
    controller.abort(user.aborted ? user.reason : timeout.reason)
  }
  user.addEventListener('abort', onAbort)
  timeout.addEventListener('abort', onAbort)
  if (user.aborted || timeout.aborted) onAbort()
  return {
    signal: controller.signal,
    timeout,
    dispose: () => {
      user.removeEventListener('abort', onAbort)
      timeout.removeEventListener('abort', onAbort)
    },
  }
}

function requestHeaders(accessToken: string): Record<string, string> {
  return {
    ...GROK_CLI_REQUEST_HEADERS,
    'X-Dsh-Plugin': GROK_PLUGIN_IDENTITY_HEADER,
    authorization: 'Bearer ' + accessToken,
    'content-type': 'application/json',
  }
}

function imagesURL(override: string | undefined): string {
  if (override !== undefined && override.length > 0) return override
  return GROK_IMAGINE_BASE_URL + '/images/generations'
}

function decodeB64(value: string, secret: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(value, 'base64'))
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message.length > 0 ? error.message : 'invalid base64'
    fail('Grok Imagine returned unreadable image data: ' + detail, secret)
  }
}

async function downloadUrl(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { authorization: 'Bearer ' + accessToken }, signal })
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message.length > 0 ? error.message : 'network error'
    fail('Grok Imagine image download failed: ' + detail, accessToken)
  }
  if (!response.ok) {
    fail('Grok Imagine image download failed with HTTP ' + String(response.status), accessToken)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function firstImage(payload: unknown, secret: string): { b64?: string, url?: string, revisedPrompt?: string } {
  if (!isRecord(payload)) fail('Grok Imagine returned an unparseable body', secret)
  const data = payload['data']
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    fail('Grok Imagine returned no image data', secret)
  }
  const row = data[0]
  const b64 = typeof row['b64_json'] === 'string' && row['b64_json'].length > 0 ? row['b64_json'] : undefined
  const url = typeof row['url'] === 'string' && row['url'].length > 0 ? row['url'] : undefined
  const revisedPrompt = typeof row['revised_prompt'] === 'string' && row['revised_prompt'].length > 0
    ? row['revised_prompt']
    : undefined
  return {
    ...b64 === undefined ? {} : { b64 },
    ...url === undefined ? {} : { url },
    ...revisedPrompt === undefined ? {} : { revisedPrompt },
  }
}

/**
 * POST Imagine `/images/generations` with a Grok session token and return raster bytes.
 * @param request - prompt, auth, and optional test overrides.
 */
export async function generateGrokImage(request: GenerateGrokImageRequest): Promise<GeneratedGrokImage> {
  const prompt = request.prompt.trim()
  if (prompt.length === 0) throw new Error('grok_image_gen prompt must not be empty')
  if (request.aspectRatio !== undefined && !(GROK_IMAGINE_ASPECT_RATIOS as readonly string[]).includes(request.aspectRatio)) {
    throw new Error('grok_image_gen aspect_ratio must be one of ' + GROK_IMAGINE_ASPECT_RATIOS.join(', '))
  }
  const timeoutMs = request.timeoutMs ?? GROK_IMAGE_GEN_TIMEOUT_MS
  const fetchImpl = request.fetchImpl ?? fetch
  const body: Record<string, unknown> = {
    model: GROK_IMAGINE_MODEL,
    prompt,
    n: 1,
    response_format: 'b64_json',
    ...request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio },
  }
  const attempts = 1 + GROK_IMAGE_GEN_TRANSPORT_RETRIES
  let raw = ''
  let response: Response | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { signal, timeout, dispose } = combineSignals(request.signal, timeoutMs)
    try {
      response = await fetchImpl(imagesURL(request.imagesURL), {
        method: 'POST',
        headers: requestHeaders(request.accessToken),
        body: JSON.stringify(body),
        signal,
      })
      raw = await response.text()
      dispose()
      break
    } catch (error: unknown) {
      dispose()
      const retryable = attempt < attempts
        && !request.signal?.aborted
        && !timeout.aborted
        && isTransportDrop(error)
      if (!retryable) fail(describeNetworkFailure(error, request.signal, timeout, timeoutMs), request.accessToken)
    }
  }
  if (response === undefined) fail('Grok Imagine request failed: network error', request.accessToken)
  if (!response.ok) {
    let detail = raw.slice(0, 500)
    try {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed) && isRecord(parsed['error']) && typeof parsed['error']['message'] === 'string') {
        detail = parsed['error']['message']
      }
    } catch { /* keep raw */ }
    fail('Grok Imagine failed with HTTP ' + String(response.status) + ': ' + detail, request.accessToken)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    fail('Grok Imagine returned an unparseable body', request.accessToken)
  }
  const image = firstImage(parsed, request.accessToken)
  const bytes = image.b64 !== undefined
    ? decodeB64(image.b64, request.accessToken)
    : image.url === undefined
      ? fail('Grok Imagine returned no image data', request.accessToken)
      : await downloadUrl(
          image.url,
          request.accessToken,
          fetchImpl,
          request.signal ?? AbortSignal.timeout(timeoutMs),
        )
  const mediaType = mediaTypeOf(bytes)
  if (mediaType === undefined) fail('Grok Imagine returned image data that is not PNG, JPEG, WebP, or GIF', request.accessToken)
  return {
    bytes,
    mediaType,
    ...image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt },
  }
}
