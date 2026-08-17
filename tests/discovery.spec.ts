import { describe, expect, it } from 'vitest'
import { parseGrokModels } from '../src/discovery.ts'

describe('parseGrokModels', () => {
  it('keeps id, name, and reasoning from models-v2 rows', () => {
    expect(parseGrokModels({
      object: 'list',
      data: [
        {
          id: 'grok-4.6',
          name: 'Grok 4.6',
          supports_reasoning_effort: true,
          reasoning_effort: 'high',
          context_window: 262144,
          reasoning_efforts: [
            { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort' },
            { id: 'high', value: 'high', label: 'High Effort' },
          ],
        },
        {
          id: 'grok-4.5',
          name: 'Grok 4.5',
          supports_reasoning_effort: true,
        },
        { id: 'grok-4.6' },
      ],
    })).toEqual([
      {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        thinking: true,
        vision: true,
        contextWindow: 262144,
        defaultReasoningEffort: 'high',
        reasoningEfforts: [
          { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort' },
          { id: 'high', value: 'high', label: 'High Effort' },
        ],
      },
      { id: 'grok-4.5', name: 'Grok 4.5', thinking: true, vision: true },
    ])
  })

  it('rejects a body without models', () => {
    expect(parseGrokModels({ data: [] })).toBeUndefined()
    expect(parseGrokModels({})).toBeUndefined()
  })
})
