import { describe, it, expect } from 'vitest'
import { resolveNpm } from './resolver.js'

describe('resolveNpm - provenance path', () => {
  it('resolves a package with provenance to a git SHA', async () => {
    // @sigstore/sign@3.0.0 has provenance (verified in registry integration tests).
    const result = await resolveNpm({ source: 'npm', name: '@sigstore/sign', version: '3.0.0' })
    expect(result).toMatchObject({
      source: 'git',
      host: 'github.com',
      org: 'sigstore',
      repo: 'sigstore-js',
      ref: expect.stringMatching(/^[a-f0-9]{40}$/),
    })
  })
})

describe('resolveNpm - repository fallback', () => {
  it('resolves a package without provenance via repository field + tag match', async () => {
    // lodash@4.17.21 has no provenance; tags are bare semver (`4.17.21`).
    const result = await resolveNpm({ source: 'npm', name: 'lodash', version: '4.17.21' })
    expect(result).toMatchObject({
      source: 'git',
      host: 'github.com',
      org: 'lodash',
      repo: 'lodash',
      ref: '4.17.21',
    })
  })
})

describe('resolveNpm - errors', () => {
  it('errors on missing package', async () => {
    await expect(
      resolveNpm({ source: 'npm', name: 'this-package-truly-does-not-exist-xyz-123', version: '1.0.0' }),
    ).rejects.toThrow(/not found/i)
  })

  it('errors on missing version', async () => {
    await expect(
      resolveNpm({ source: 'npm', name: 'lodash', version: '99.99.99' }),
    ).rejects.toThrow(/not found/i)
  })
})

describe('resolveNpm - dist-tags', () => {
  it('resolves latest dist-tag', async () => {
    const result = await resolveNpm({ source: 'npm', name: 'lodash' })
    expect(result.source).toBe('git')
    expect(result.org).toBe('lodash')
    expect(result.repo).toBe('lodash')
    // ref will vary as releases happen - just confirm it's set
    expect(result.ref).toBeDefined()
  })
})
