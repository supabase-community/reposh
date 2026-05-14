import { describe, it, expect, vi } from 'vitest'
import { resolveTarget } from './resolve-target.js'
import type { GitTarget, NpmTarget } from './types.js'

vi.mock('./npm/resolver.js', () => ({
  resolveNpm: vi.fn(async (target: NpmTarget): Promise<GitTarget> => ({
    source: 'git',
    host: 'github.com',
    org: 'mock',
    repo: target.name.replace(/[@/]/g, '-'),
    ref: 'mock-sha',
  })),
}))

describe('resolveTarget', () => {
  it('returns git targets unchanged', async () => {
    const git: GitTarget = {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    }
    await expect(resolveTarget(git)).resolves.toEqual(git)
  })

  it('delegates npm targets to resolveNpm', async () => {
    const npm: NpmTarget = { source: 'npm', name: 'lodash', version: '4.17.21' }
    const result = await resolveTarget(npm)
    expect(result.source).toBe('git')
    expect(result.org).toBe('mock')
    expect(result.ref).toBe('mock-sha')
  })
})
