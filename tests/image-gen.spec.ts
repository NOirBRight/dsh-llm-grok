import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { CallId, LlmRuntime } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { GROK_IMAGINE_MODEL } from '../src/image-gen-client.ts'
import { GROK_IMAGE_GEN_TOOL_NAME, grokImageGenTool } from '../src/image-gen.ts'
import * as Grok from '../src/index.ts'
import { writeSession } from '../src/session.ts'
import { closeFakeProxies, fakeChatProxy } from './fake-proxy.ts'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
  'base64',
)
const signal = new AbortController().signal

let workspace: string
let dshHome: string
let ctx: Context | undefined
let callCounter = 0

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-image-gen-'))
  dshHome = await mkdtemp(join(tmpdir(), 'dsh-llm-grok-image-gen-home-'))
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await closeFakeProxies()
  await rm(workspace, { recursive: true, force: true })
  await rm(dshHome, { recursive: true, force: true })
})

async function bootRuntime(): Promise<Context> {
  const context = new Context()
  ctx = context
  context.provide(
    'launchEnvironment',
    createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: dshHome } }]),
  )
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime, { mode: 'native' })
  await context.plugin(LocalFileSystem, { cwd: workspace })
  await context.plugin(LocalAttachmentStore, { dshHome })
  await context.plugin(LlmRuntime)
  return context
}

function agent(): object {
  return {
    options: {},
    session: {
      header: { cwd: workspace },
      requestHeader: () => ({ config: { provider: Grok.GROK_PROVIDER, model: 'grok-4.6' } }),
      append: () => undefined,
    },
  }
}

async function generate(context: Context, args: Record<string, unknown>) {
  return context.tools.execute({
    signal,
    callId: CallId('grok-image-' + String(++callCounter)),
    name: GROK_IMAGE_GEN_TOOL_NAME,
    arguments: args,
    agent: agent() as never,
  })
}

describe('grok_image_gen', () => {
  it('does not register the tool when enableImageGen is off', async () => {
    const context = await bootRuntime()
    await context.plugin(Grok, { enableImageGen: false })
    expect(context.tools.get(GROK_IMAGE_GEN_TOOL_NAME)).toBeUndefined()
  })

  it('registers grok_image_gen when enableImageGen is on', async () => {
    const context = await bootRuntime()
    await context.plugin(Grok, { enableImageGen: true })
    expect(context.tools.get(GROK_IMAGE_GEN_TOOL_NAME)?.name).toBe('grok_image_gen')
  })

  it('writes a workspace file and returns an image block', async () => {
    const proxy = await fakeChatProxy([{
      kind: 'json',
      status: 200,
      body: { data: [{ b64_json: PNG_1X1.toString('base64') }] },
    }])
    const context = await bootRuntime()
    await writeSession(join(dshHome, 'grok-oauth.json'), {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      email: 'user@example.test',
    })
    context.tools.register(grokImageGenTool(context, {
      resolveAccessToken: async () => 'access-secret',
      imagesURL: proxy.url + '/images/generations',
    }))

    const result = await generate(context, { prompt: 'a red pixel', path: 'out/pixel.png' })

    expect(result.isError).toBe(false)
    expect(result.content.some(block => block.type === 'image')).toBe(true)
    expect(result.content.find(block => block.type === 'text')?.text).toContain(GROK_IMAGINE_MODEL)
    expect(await readFile(join(workspace, 'out/pixel.png'))).toEqual(PNG_1X1)
    expect(context.tools.get(GROK_IMAGE_GEN_TOOL_NAME)?.presentCall?.({
      prompt: 'a red pixel',
      path: 'out/pixel.png',
    })).toMatchObject({
      kind: 'other',
      locations: [{ path: 'out/pixel.png' }],
    })
    expect(proxy.requests[0]?.body).toMatchObject({ prompt: 'a red pixel', model: GROK_IMAGINE_MODEL })
  })

  it('normalizes a custom path extension to the generated media type', async () => {
    const proxy = await fakeChatProxy([{ kind: 'json', status: 200, body: { data: [{ b64_json: JPEG_1X1.toString('base64') }] } }])
    const context = await bootRuntime()
    context.tools.register(grokImageGenTool(context, { resolveAccessToken: async () => 'access-secret', imagesURL: proxy.url + '/images/generations' }))
    const result = await generate(context, { prompt: 'a red pixel', path: 'out/pixel.png' })
    expect(result.isError).toBe(false)
    expect(result.content.find(block => block.type === 'text')?.text).toContain('out/pixel.jpg')
    expect(await readFile(join(workspace, 'out/pixel.jpg'))).toEqual(JPEG_1X1)
  })

  it('fails unsigned-in plugin calls without leaking a network request', async () => {
    const proxy = await fakeChatProxy([])
    const context = await bootRuntime()
    context.tools.register(grokImageGenTool(context, {
      resolveAccessToken: () => Grok.resolveGrokAccessToken(Grok.createGrokAuthRuntime({
        resolveSessionPath: () => join(dshHome, 'grok-oauth.json'),
      })),
      imagesURL: proxy.url + '/images/generations',
    }))

    const result = await generate(context, { prompt: 'a cat' })

    expect(result.isError).toBe(true)
    expect(result.content.find(block => block.type === 'text')?.text).toMatch(/not signed in/iu)
    expect(proxy.requests).toHaveLength(0)
  })
})
