/**
 * Register the `grok` provider directory entry and the `llm-grok` settings
 * section. Chat and OAuth are not installed yet; this face only contributes
 * Plugin configuration identity so the Web card can render. The route is
 * distinct from the built-in `xai` console-key provider.
 * @module dsh-llm-grok
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_SETTINGS_NAMESPACE,
} from './client-contract.ts'

export {
  GROK_CATALOG,
  GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GROK_PROVIDER,
  GROK_SETTINGS_NAMESPACE,
  decodeGrokSettings,
} from './client-contract.ts'
export type { GrokCatalogModel, GrokSettingsView } from './client-contract.ts'

export const name = 'llm-grok'
export const inject = ['llm']

const NS = settingsNamespace(GROK_SETTINGS_NAMESPACE)

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-grok` settings-section shape. There is no `apiKeyEnv`: this
 * provider authenticates with an xAI subscription, not a console API key.
 */
export interface Config {
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

export const Config: z<Config> = z.object({
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(
    GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  ),
  retryPolicy: RetryPolicySchema,
})

export function apply(ctx: Context, config: Config): void {
  ctx.llm.registerConfigurableProviders([
    { provider: GROK_PROVIDER, displayName: 'Grok', settingsNs: NS, settingsPath: [] },
  ])

  installSettingsSection(ctx, NS, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })
}
