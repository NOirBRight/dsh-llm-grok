import { afterEach, describe, expect, it } from 'vitest'
import { GROK_CLI_CLIENT_IDENTIFIER, GROK_CLI_CLIENT_VERSION } from '../src/cli-identity.ts'
import {
  GROK_IMAGINE_MODEL,
  generateGrokImage,
} from '../src/image-gen-client.ts'
import { GROK_PLUGIN_IDENTITY_HEADER } from '../src/pi-ai-profile.ts'
import { closeFakeProxies, fakeChatProxy } from './fake-proxy.ts'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

afterEach(async () => {
  await closeFakeProxies()
})

describe('generateGrokImage', () => {
  it('posts b64_json Imagine REST with the session token and CLI identity headers', async () => {
    const proxy = await fakeChatProxy([{
      kind: 'json',
      status: 200,
      body: {
        data: [{ b64_json: PNG_1X1.toString('base64'), revised_prompt: 'a red pixel' }],
      },
    }])

    const image = await generateGrokImage({
      accessToken: 'access-secret',
      prompt: ' a red pixel ',
      aspectRatio: '1:1',
      imagesURL: proxy.url + '/images/generations',
    })

    expect(image.mediaType).toBe('image/png')
    expect(image.revisedPrompt).toBe('a red pixel')
    expect(Buffer.from(image.bytes)).toEqual(PNG_1X1)
    expect(proxy.requests).toHaveLength(1)
    expect(proxy.requests[0]?.path).toBe('/images/generations')
    expect(proxy.requests[0]?.headers.authorization).toBe('Bearer access-secret')
    expect(proxy.requests[0]?.headers['x-grok-client-version']).toBe(GROK_CLI_CLIENT_VERSION)
    expect(proxy.requests[0]?.headers['x-grok-client-identifier']).toBe(GROK_CLI_CLIENT_IDENTIFIER)
    expect(proxy.requests[0]?.headers['x-dsh-plugin']).toBe(GROK_PLUGIN_IDENTITY_HEADER)
    expect(proxy.requests[0]?.body).toEqual({
      model: GROK_IMAGINE_MODEL,
      prompt: 'a red pixel',
      n: 1,
      response_format: 'b64_json',
      aspect_ratio: '1:1',
    })
  })

  it('redacts the access token from Imagine HTTP errors', async () => {
    const proxy = await fakeChatProxy([{
      kind: 'json',
      status: 401,
      body: { error: { message: 'invalid token access-secret' } },
    }])

    await expect(generateGrokImage({
      accessToken: 'access-secret',
      prompt: 'a cat',
      imagesURL: proxy.url + '/images/generations',
    })).rejects.toThrow(/HTTP 401[\s\S]*\[redacted\]/u)
  })

  it('rejects an empty prompt before any network call', async () => {
    await expect(generateGrokImage({
      accessToken: 'access-secret',
      prompt: '   ',
    })).rejects.toThrow('grok_image_gen prompt must not be empty')
  })

  it('maps an undici body drop to a readable error instead of bare terminated', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      throw new Error('terminated')
    }
    await expect(generateGrokImage({
      accessToken: 'access-secret',
      prompt: 'a cat',
      fetchImpl,
      timeoutMs: 5_000,
    })).rejects.toThrow(/connection dropped[\s\S]*terminated/u)
    expect(calls).toBe(2)
  })

  it('retries once when the Imagine body stream is terminated, then succeeds', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) throw new Error('terminated')
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG_1X1.toString('base64') }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const image = await generateGrokImage({
      accessToken: 'access-secret',
      prompt: 'a cat',
      fetchImpl,
    })
    expect(calls).toBe(2)
    expect(image.mediaType).toBe('image/png')
    expect(Buffer.from(image.bytes)).toEqual(PNG_1X1)
  })
})

