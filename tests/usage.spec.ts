import { afterEach, describe, expect, it } from 'vitest'
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

  it('marks unrecognized JSON as unsupported', async () => {
    const server = await fakeBillingServer([
      { status: 200, body: { quota: { remaining: 3 } } },
    ])

    await expect(readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    })).resolves.toEqual({ status: 'unsupported' })
  })

  it('marks a non-JSON body as unsupported', async () => {
    const server = await fakeBillingServer([{ status: 200, body: 'not-json' }])

    await expect(readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    })).resolves.toEqual({ status: 'unsupported' })
  })

  it('tells the user to re-login when billing rejects a non-CLI token', async () => {
    const server = await fakeBillingServer([{
      status: 403,
      body: { error: 'Action must be performed by Grok CLI token users.' },
    }])

    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: server.url,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/Sign out and sign in again/u)
    expect((failure as Error).message).not.toMatch(/access-secret/u)
  })

  it('surfaces a transport failure without token material', async () => {
    const failure = await readGrokUsage({
      accessToken: 'access-secret',
      billingURL: 'http://127.0.0.1:1/v1/billing',
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
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
