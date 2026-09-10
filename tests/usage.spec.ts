import { afterEach, describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  decodeGrokUsageReply,
  decodeGrokUsageView,
} from '../src/client-contract.ts'
import { parseGrokBilling, readGrokUsage } from '../src/usage.ts'
import { closeFakeBillingServers, fakeBillingServer } from './fake-billing-server.ts'

afterEach(async () => {
  await closeFakeBillingServers()
})

const documented = {
  windows: [
    { id: 'monthly', used: 12, limit: 100, period: 'month' },
    { id: 'weekly', used: 3, limit: 20 },
  ],
}

/** A fetch override that hangs until its signal aborts (timeout/abort lifecycle checks). */
const abortableHang: typeof fetch = (_input, init) => new Promise<never>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => {
    reject(new DOMException('The operation was aborted.', 'AbortError'))
  }, { once: true })
})

describe('parseGrokBilling', () => {
  it('keeps documented windows and drops malformed rows', () => {
    const usage = parseGrokBilling({
      windows: [
        { id: 'monthly', used: 12, limit: 100, period: 'month' },
        { id: '', used: 1, limit: 2 },
        { id: 'broken', used: -1, limit: 10 },
        'garbage',
        { id: 'weekly', used: 3, limit: 20 },
      ],
    }, '2026-08-17T00:00:00.000Z')

    expect(usage).toEqual({
      fetchedAt: '2026-08-17T00:00:00.000Z',
      windows: [
        { id: 'monthly', used: 12, limit: 100, period: 'month' },
        { id: 'weekly', used: 3, limit: 20 },
      ],
    })
  })

  it('reads SuperGrok weekly credit usage', () => {
    const usage = parseGrokBilling({
      config: {
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-08-16T16:26:18.098562+00:00',
          end: '2026-08-23T16:26:18.098562+00:00',
        },
        creditUsagePercent: 1,
        productUsage: [{ product: 'GrokBuild', usagePercent: 1 }],
        billingPeriodStart: '2026-08-16T16:26:18.098562+00:00',
        billingPeriodEnd: '2026-08-23T16:26:18.098562+00:00',
      },
    }, '2026-08-17T00:00:00.000Z')

    expect(usage).toEqual({
      fetchedAt: '2026-08-17T00:00:00.000Z',
      windows: [
        {
          id: 'GrokBuild',
          used: 1,
          limit: 100,
          unit: 'percent',
          period: 'week',
          resetsAt: '2026-08-23T16:26:18.098Z',
        },
      ],
    })
  })

  it('reads the cli-chat-proxy config envelope', () => {
    const usage = parseGrokBilling({
      config: {
        monthlyLimit: { val: 20 },
        used: { val: 4 },
        onDemandCap: { val: 0 },
        billingPeriodStart: '2026-08-01T00:00:00+00:00',
        billingPeriodEnd: '2026-09-01T00:00:00+00:00',
      },
    }, '2026-08-17T00:00:00.000Z')

    expect(usage).toEqual({
      fetchedAt: '2026-08-17T00:00:00.000Z',
      windows: [
        { id: 'monthly', used: 4, limit: 20, resetsAt: '2026-09-01T00:00:00.000Z' },
      ],
    })
  })

  it('marks an unknown body as unsupported', () => {
    expect(parseGrokBilling({ limits: { monthly: 1 } }, '2026-08-17T00:00:00.000Z')).toBeUndefined()
    expect(parseGrokBilling({ windows: [] }, '2026-08-17T00:00:00.000Z')).toBeUndefined()
    expect(parseGrokBilling(null, '2026-08-17T00:00:00.000Z')).toBeUndefined()
  })
})

describe('readGrokUsage', () => {
  it('reads documented windows with the bearer token', async () => {
    const server = await fakeBillingServer([{ status: 200, body: documented }])

    const result = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
      now: () => Date.parse('2026-08-17T00:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-08-17T00:00:00.000Z',
        windows: [
          { id: 'monthly', used: 12, limit: 100, period: 'month' },
          { id: 'weekly', used: 3, limit: 20 },
        ],
      },
    })
    expect(server.requests).toEqual([
      { method: 'GET', url: '/v1/billing', authorization: 'Bearer access-secret' },
    ])
    expect(JSON.stringify(result)).not.toMatch(/access-secret/u)
  })

  it('marks a 404 as an endpoint without a billing surface', async () => {
    const server = await fakeBillingServer([{ status: 404, body: { error: 'not found' } }])

    await expect(readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    })).resolves.toEqual({ status: 'unsupported' })
  })

  it('throws on unrecognized 200 JSON instead of claiming unsupported', async () => {
    const server = await fakeBillingServer([
      { status: 200, body: { quota: { remaining: 3 } } },
    ])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/unrecognized billing surface/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('decodes the live unified envelope (omitted percent + valid period) as 0% used', async () => {
    const server = await fakeBillingServer([{
      status: 200,
      body: {
        config: {
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
          onDemandCap: { val: 0 },
          onDemandUsed: { val: 0 },
          isUnifiedBillingUser: true,
          prepaidBalance: { val: 0 },
          billingPeriodStart: '2026-09-06T16:26:18.098562+00:00',
          billingPeriodEnd: '2026-09-13T16:26:18.098562+00:00',
        },
      },
    }])

    const result = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
      now: () => Date.parse('2026-09-07T00:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-09-07T00:00:00.000Z',
        windows: [{
          id: 'weekly',
          used: 0,
          limit: 100,
          unit: 'percent',
          period: 'week',
          resetsAt: '2026-09-13T16:26:18.098Z',
        }],
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/access-secret/u)
  })

  it('keeps the explicit percent fallback when productUsage is malformed', async () => {
    const server = await fakeBillingServer([{
      status: 200,
      body: {
        config: {
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
          productUsage: [{ product: '', usagePercent: 1 }],
          creditUsagePercent: 5,
        },
      },
    }])

    const result = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
      now: () => Date.parse('2026-09-07T00:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-09-07T00:00:00.000Z',
        windows: [{
          id: 'weekly',
          used: 5,
          limit: 100,
          unit: 'percent',
          period: 'week',
          resetsAt: '2026-09-13T16:26:18.098Z',
        }],
      },
    })
  })

  it('parses the explicit legacy budget instead of the zero default', async () => {
    const server = await fakeBillingServer([{
      status: 200,
      body: {
        config: {
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
          monthlyLimit: { val: 100 },
          used: { val: 25 },
        },
      },
    }])

    const result = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
      now: () => Date.parse('2026-09-07T00:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-09-07T00:00:00.000Z',
        windows: [{
          id: 'monthly',
          used: 25,
          limit: 100,
          period: 'week',
          resetsAt: '2026-09-13T16:26:18.098Z',
        }],
      },
    })
  })

  it.each([
    ['negative explicit percent', -5],
    ['explicit percent above 100', 150],
  ])('rejects an out-of-range %s instead of clamping it to quota', (_label, percent) => {
    expect(parseGrokBilling({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
        creditUsagePercent: percent,
      },
    }, '2026-09-07T00:00:00.000Z')).toBeUndefined()
  })

  it('labels the explicit summary monthly for a known monthly period', () => {
    expect(parseGrokBilling({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
        creditUsagePercent: 5,
      },
    }, '2026-09-07T00:00:00.000Z')).toEqual({
      fetchedAt: '2026-09-07T00:00:00.000Z',
      windows: [{ id: 'monthly', used: 5, limit: 100, unit: 'percent', period: 'month', resetsAt: '2026-10-01T00:00:00.000Z' }],
    })
  })

  it('labels the omitted-zero summary monthly for a known monthly period', () => {
    expect(parseGrokBilling({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      },
    }, '2026-09-07T00:00:00.000Z')).toEqual({
      fetchedAt: '2026-09-07T00:00:00.000Z',
      windows: [{ id: 'monthly', used: 0, limit: 100, unit: 'percent', period: 'month', resetsAt: '2026-10-01T00:00:00.000Z' }],
    })
  })

  it('drops an out-of-range product entry instead of clamping it', () => {
    expect(parseGrokBilling({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
        productUsage: [{ product: 'GrokBuild', usagePercent: -5 }],
      },
    }, '2026-09-07T00:00:00.000Z')).toBeUndefined()
  })

  it('throws on an out-of-range explicit percent instead of inventing quota', async () => {
    const server = await fakeBillingServer([{
      status: 200,
      body: {
        config: {
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' },
          creditUsagePercent: -5,
        },
      },
    }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
      now: () => Date.parse('2026-09-07T00:00:00.000Z'),
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/unrecognized billing surface/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('throws on a 500 instead of claiming unsupported', async () => {
    const server = await fakeBillingServer([{ status: 500, body: { error: 'internal' } }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/answered 500/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('refuses a billing body larger than 1MB', async () => {
    const server = await fakeBillingServer([{
      status: 200,
      body: { windows: [{ id: 'monthly', used: 1, limit: 2, note: 'x'.repeat(1024 * 1024 + 8) }] },
    }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/more than .* bytes/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('reports caller cancellation without token material', async () => {
    const controller = new AbortController()
    const pending = readGrokUsage({
      accessToken: 'access-secret',
      billingURL: 'http://127.0.0.1:1/v1/billing',
      fetch: abortableHang,
      signal: controller.signal,
    })
    controller.abort()

    const failure = await pending.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/aborted by caller/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('times out a hanging billing read', async () => {
    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: 'http://127.0.0.1:1/v1/billing',
      fetch: abortableHang,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/could not reach/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it.each([
    ['missing currentPeriod', {}],
    ['missing period start', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-09-13T16:26:18.098562+00:00' } }],
    ['unknown period type', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_DAILY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' } }],
    ['malformed period end', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: 'not-a-date' } }],
    ['expired period', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-08-16T16:26:18.098562+00:00', end: '2026-08-23T16:26:18.098562+00:00' } }],
    ['malformed product entries', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, productUsage: [{ product: '', usagePercent: 1 }] }],
    ['string productUsage', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, productUsage: 'GrokBuild' }],
    ['object productUsage', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, productUsage: { product: 'GrokBuild', usagePercent: 1 } }],
    ['wrong-typed percent', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, creditUsagePercent: 'none' }],
    ['malformed legacy budget', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, monthlyLimit: { val: 100 }, used: 'many' }],
    ['paid on-demand pool', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, onDemandCap: { val: 100 }, onDemandUsed: { val: 5 } }],
    ['malformed on-demand object', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, onDemandCap: { bogus: 1 } }],
    ['paid prepaid pool', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, prepaidBalance: { val: 50 } }],
    ['malformed prepaid object', { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T16:26:18.098562+00:00', end: '2026-09-13T16:26:18.098562+00:00' }, prepaidBalance: { bogus: 1 } }],
  ])('throws instead of defaulting when the omitted-percent envelope has %s', async (_label, extra) => {
    const server = await fakeBillingServer([{
      status: 200,
      body: { config: { isUnifiedBillingUser: true, ...extra } },
    }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
      now: () => Date.parse('2026-09-07T00:00:00.000Z'),
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/unrecognized billing surface/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('throws on a non-JSON body instead of claiming unsupported', async () => {
    const server = await fakeBillingServer([{ status: 200, body: 'not-json' }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/not JSON/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it.each([401, 403])('fails a %i rejection as an unusable credential', async (status) => {
    const server = await fakeBillingServer([{
      status,
      body: { error: 'Action must be performed by Grok CLI token users.' },
    }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).code).toBe('INVALID_CREDENTIAL')
    expect((failure as Error).message).toMatch(/Sign out and sign in again/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('keeps a 500 out of the credential class', async () => {
    const server = await fakeBillingServer([{ status: 500, body: { error: 'internal' } }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(LlmError)
  })

  it('surfaces a transport failure without token material', async () => {
    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: 'http://127.0.0.1:1/v1/billing',
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(LlmError)
    expect((failure as Error).message).toMatch(/could not reach/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })
})

describe('decodeGrokUsageReply', () => {
  it('accepts ok, unsupported, and logged-out replies', () => {
    expect(decodeGrokUsageReply({ status: 'unsupported' })).toEqual({ status: 'unsupported' })
    expect(decodeGrokUsageReply({ status: 'logged-out' })).toEqual({ status: 'logged-out' })
    expect(decodeGrokUsageReply({
      status: 'ok',
      usage: {
        fetchedAt: '2026-08-17T00:00:00.000Z',
        windows: [{ id: 'monthly', used: 1, limit: 10 }],
      },
    })).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-08-17T00:00:00.000Z',
        windows: [{ id: 'monthly', used: 1, limit: 10 }],
      },
    })
  })

  it('rejects snapshots that carry token fields', () => {
    expect(decodeGrokUsageReply({
      status: 'ok',
      accessToken: 'secret',
      usage: {
        fetchedAt: '2026-08-17T00:00:00.000Z',
        windows: [{ id: 'monthly', used: 1, limit: 10 }],
      },
    })).toBeUndefined()
    expect(decodeGrokUsageView({
      fetchedAt: '2026-08-17T00:00:00.000Z',
      accessToken: 'secret',
      windows: [{ id: 'monthly', used: 1, limit: 10 }],
    })).toBeUndefined()
  })
})
