import { describe, expect, it } from 'vitest'
import { liftSystemMessages } from '../src/responses-tools.ts'

describe('liftSystemMessages (pi-ai 0.85.x system-message backport)', () => {
  it('returns the context untouched when no system messages are present', () => {
    const context = {
      systemPrompt: 'keep me',
      messages: [
        { role: 'user', content: 'hi', timestamp: 0 },
      ],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
    } as never
    expect(liftSystemMessages(context)).toBe(context)
  })

  it('folds a string-content system message into systemPrompt', () => {
    const next = liftSystemMessages({
      systemPrompt: undefined,
      messages: [
        { role: 'system', content: 'You are a coding agent.', timestamp: 0 },
        { role: 'user', content: '只回复:ok', timestamp: 0 },
      ],
    } as never)
    expect(next.systemPrompt).toBe('You are a coding agent.')
    expect((next.messages as Array<{ role: string }>).map(message => message.role)).toEqual(['user'])
  })

  it('prepends ahead of an existing systemPrompt and keeps order', () => {
    const next = liftSystemMessages({
      systemPrompt: 'base',
      messages: [
        { role: 'system', content: 'first', timestamp: 0 },
        { role: 'system', content: [{ type: 'text', text: 'second' }], timestamp: 0 },
        { role: 'user', content: 'go', timestamp: 0 },
      ],
    } as never)
    expect(next.systemPrompt).toBe('base\n\nfirst\n\nsecond')
    expect(next.messages).toHaveLength(1)
  })

  it('merges toolsAdded into context.tools and dedupes by name', () => {
    const next = liftSystemMessages({
      messages: [
        {
          role: 'system',
          content: 'declare tools',
          toolsAdded: [
            { name: 'bash', description: 'run', parameters: { type: 'object' } },
            { name: 'grep', description: 'search', parameters: { type: 'object' } },
          ],
          timestamp: 0,
        },
        { role: 'user', content: 'go', timestamp: 0 },
      ],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
    } as never)
    const tools = (next.tools as Array<{ name: string }>) ?? []
    expect(tools.map(tool => tool.name)).toEqual(['bash', 'grep'])
  })

  it('declares tools from toolsAdded when context.tools is empty', () => {
    const next = liftSystemMessages({
      messages: [
        {
          role: 'system',
          content: 'declare',
          toolsAdded: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
          timestamp: 0,
        },
      ],
    } as never)
    expect(((next.tools as Array<{ name: string }>) ?? []).map(tool => tool.name)).toEqual(['bash'])
  })

  it('drops tools named by toolsRemoved', () => {
    const next = liftSystemMessages({
      messages: [
        {
          role: 'system',
          content: 'cleanup',
          toolsRemoved: [{ name: 'grep' }],
          timestamp: 0,
        },
      ],
      tools: [
        { name: 'bash', description: 'run', parameters: { type: 'object' } },
        { name: 'grep', description: 'search', parameters: { type: 'object' } },
      ],
    } as never)
    expect(((next.tools as Array<{ name: string }>) ?? []).map(tool => tool.name)).toEqual(['bash'])
  })

  it('clears systemPrompt when every system message is empty', () => {
    const next = liftSystemMessages({
      systemPrompt: undefined,
      messages: [{ role: 'system', content: '', timestamp: 0 }, { role: 'user', content: 'go', timestamp: 0 }],
    } as never)
    expect(next.systemPrompt).toBeUndefined()
  })
})
