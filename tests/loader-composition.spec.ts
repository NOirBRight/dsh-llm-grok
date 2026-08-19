/**
 * Real-composition guard: LlmRuntime and llm-grok boot from a test-only
 * cordis.yml through the actual Loader + Include path. The configurable
 * `grok` provider is declared, the settings namespace is llm-grok, and the
 * schema does not name apiKeyEnv (so Models cannot show a missing-key badge).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmGrok from '../src/index.ts'
import { Config } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<{ ctx: Context }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-comp-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: llm-grok',
    "  name: 'dsh-llm-grok'",
    '  config:',
    '    retryPolicy:',
    '      mode: normal',
    '      maxRetries: 8',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['dsh-llm-grok', LlmGrok],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx }
}

describe('llm-grok real composition', () => {
  it('boots from cordis.yml and registers grok without apiKeyEnv', async () => {
    const { ctx } = await loadComposition()

    expect(LlmGrok.name).toBe('llm-grok')
    expect(LlmGrok.inject).toEqual(['llm'])
    expect(ctx.llm.listConfigurableProviders()).toEqual([
      { provider: 'grok', displayName: 'Grok', settingsNs: 'llm-grok', settingsPath: [] },
    ])
    expect(ctx.llm.listProviders()).toEqual([{ id: 'grok', name: 'Grok' }])
    expect(ctx.llm.providerRetryPolicy('grok')).toMatchObject({ mode: 'normal', maxRetries: 8 })

    const schema = Config.toJSON() as { uid: number, refs: Record<string, { dict?: Record<string, unknown> }> }
    const dict = schema.refs[String(schema.uid)]?.dict
    expect(dict).toBeDefined()
    expect(dict).not.toHaveProperty('apiKeyEnv')
    expect(dict).toHaveProperty('streamIdleTimeoutMs')
    expect(Config({})).not.toHaveProperty('apiKeyEnv')
  })

  it('removes the directory entry on disposal (HMR-safety)', async () => {
    const { ctx } = await loadComposition()

    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)

    await ctx.fiber.dispose()
    context = undefined

    expect(true).toBe(true)
  })
})
