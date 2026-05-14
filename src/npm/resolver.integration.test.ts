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

describe('resolveNpm - caching', () => {
  it('reads from disk cache on second invocation', async () => {
    // First call populates the cache
    const a = await resolveNpm({ source: 'npm', name: '@sigstore/sign', version: '3.0.0' })
    // Second call should return identical result
    const b = await resolveNpm({ source: 'npm', name: '@sigstore/sign', version: '3.0.0' })
    expect(b).toEqual(a)
  })

  it('force bypasses the disk cache', async () => {
    // Populate cache
    await resolveNpm({ source: 'npm', name: '@sigstore/sign', version: '3.0.0' })
    // Force should still resolve correctly (network roundtrip happens, but we can't easily assert that here without mocking)
    const fresh = await resolveNpm({ source: 'npm', name: '@sigstore/sign', version: '3.0.0' }, { force: true })
    expect(fresh.source).toBe('git')
    expect(fresh.org).toBe('sigstore')
  })

  it('normalizes omitted version and @latest to the same cache entry', async () => {
    // First call: omitted version (normalized to latest)
    const a = await resolveNpm({ source: 'npm', name: 'lodash' })
    // Second call: explicit @latest
    const b = await resolveNpm({ source: 'npm', name: 'lodash', version: 'latest' })
    expect(b).toEqual(a)
  })
})
