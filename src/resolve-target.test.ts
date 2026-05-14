import { describe, it, expect } from 'vitest'
import { resolveTarget } from './resolve-target.js'
import type { GitTarget, NpmTarget } from './types.js'

describe('resolveTarget', () => {
  it('returns git targets unchanged', async () => {
    const git: GitTarget = {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    }
    await expect(resolveTarget(git)).resolves.toEqual(git)
  })

  it('throws for npm targets (not yet implemented)', async () => {
    const npm: NpmTarget = { source: 'npm', name: 'lodash', version: '4.17.21' }
    await expect(resolveTarget(npm)).rejects.toThrow(/npm/i)
  })
})
