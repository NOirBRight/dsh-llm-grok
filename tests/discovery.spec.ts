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
        },
        {
          id: 'grok-4.5',
          name: 'Grok 4.5',
          supports_reasoning_effort: true,
        },
        { id: 'grok-4.6' },
      ],
    })).toEqual([
      { id: 'grok-4.6', name: 'Grok 4.6', thinking: true, vision: true },
      { id: 'grok-4.5', name: 'Grok 4.5', thinking: true, vision: true },
    ])
  })

  it('rejects a body without models', () => {
    expect(parseGrokModels({ data: [] })).toBeUndefined()
    expect(parseGrokModels({})).toBeUndefined()
  })
})
