import { describe, it, expect } from 'vitest'
import { tagCandidates } from './tag-candidates.js'

describe('tagCandidates', () => {
  it('produces canonical candidates for unscoped package', () => {
    expect(tagCandidates('lodash', '4.17.21')).toEqual([
      'v4.17.21',
      '4.17.21',
      'lodash@4.17.21',
      'lodash-v4.17.21',
      'lodash-4.17.21',
    ])
  })

  it('flattens scope for scoped package tags', () => {
    expect(tagCandidates('@types/node', '20.0.0')).toEqual([
      'v20.0.0',
      '20.0.0',
      'types-node@20.0.0',
      'types-node-v20.0.0',
      'types-node-20.0.0',
    ])
  })

  it('handles single-name scoped packages', () => {
    expect(tagCandidates('@vercel/edge', '1.0.0')).toEqual([
      'v1.0.0',
      '1.0.0',
      'vercel-edge@1.0.0',
      'vercel-edge-v1.0.0',
      'vercel-edge-1.0.0',
    ])
  })
})
