import { describe, expect, it } from 'vitest'
import {
  applyGrokReasoningWire,
  grokThinkingLevelMap,
  officialDefaultEffort,
  resolveGrokReasoningWire,
} from '../src/reasoning.ts'
import { GROK_CATALOG } from '../src/client-contract.ts'

const grok46 = GROK_CATALOG.find(model => model.id === 'grok-4.6')
const grok45 = GROK_CATALOG.find(model => model.id === 'grok-4.5')
if (grok46 === undefined || grok45 === undefined) throw new Error('frozen catalog missing grok-4.6 / grok-4.5')

describe('official Grok reasoning wire', () => {
  it('maps only advertised models-v2 values and defaults to high', () => {
    expect(officialDefaultEffort(grok46)).toBe('high')
    expect(officialDefaultEffort(grok45)).toBe('high')
    expect(grokThinkingLevelMap(grok46)).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    })
    expect(grokThinkingLevelMap(grok45).xhigh).toBeNull()
  })

  it('resolves menu id and wire value, and remaps off/none', () => {
    expect(resolveGrokReasoningWire('xhigh', grok46)).toBe('xhigh')
    expect(resolveGrokReasoningWire('xhigh', grok45)).toBe('high')
    expect(resolveGrokReasoningWire('off', grok46)).toBe('high')
    expect(resolveGrokReasoningWire('none', grok46)).toBe('high')
    expect(resolveGrokReasoningWire(undefined, grok46)).toBe('high')
  })

  it('rewrites Responses bodies to reasoning.effort only', () => {
    expect(applyGrokReasoningWire({
      model: 'grok-4.6',
      reasoning: { effort: 'none', summary: 'auto' },
    }, grok46)).toEqual({
      model: 'grok-4.6',
      reasoning: { effort: 'high' },
    })
    expect(applyGrokReasoningWire({
      model: 'grok-4.6',
      reasoning: { effort: 'xhigh', summary: 'auto' },
    }, grok46)).toEqual({
      model: 'grok-4.6',
      reasoning: { effort: 'xhigh' },
    })
    expect(applyGrokReasoningWire({ model: 'grok-4.6' }, grok46)).toEqual({
      model: 'grok-4.6',
      reasoning: { effort: 'high' },
    })
  })
})
