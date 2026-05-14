import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveNpm } from './resolver.js'
import { writeResolution } from './resolutions-cache.js'

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

describe('resolveNpm - local-first', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'reposh-resolver-local-'))
    // Set up a fake node_modules/lodash@4.17.20
    const lodashDir = join(projectDir, 'node_modules', 'lodash')
    await mkdir(lodashDir, { recursive: true })
    await writeFile(
      join(lodashDir, 'package.json'),
      JSON.stringify({
        name: 'lodash',
        version: '4.17.20', // deliberately different from latest
        repository: 'https://github.com/lodash/lodash.git',
      }),
    )
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('resolves npm:<pkg> (omitted version) to the locally installed version', async () => {
    const result = await resolveNpm(
      { source: 'npm', name: 'lodash' },
      { cwd: projectDir },
    )
    expect(result.ref).toBe('4.17.20') // matches local, not latest
    expect(result.org).toBe('lodash')
    expect(result.repo).toBe('lodash')
  })

  it('does not use local resolution when cwd is not provided', async () => {
    const result = await resolveNpm({ source: 'npm', name: 'lodash' })
    // ref will be whatever 'latest' currently is - just confirm shape.
    expect(result.org).toBe('lodash')
    expect(result.repo).toBe('lodash')
  })

  it('npm:<pkg>@latest bypasses local resolution', async () => {
    const result = await resolveNpm(
      { source: 'npm', name: 'lodash', version: 'latest' },
      { cwd: projectDir },
    )
    // Explicit latest goes to registry, not local. Confirm shape - we don't
    // assert a specific ref because latest moves over time.
    expect(result.org).toBe('lodash')
    expect(result.repo).toBe('lodash')
  })
})

describe('resolveNpm - stale serving on registry failure', () => {
  let resolutionsDir: string

  beforeEach(async () => {
    resolutionsDir = await mkdtemp(join(tmpdir(), 'reposh-stale-test-'))
  })

  afterEach(async () => {
    await rm(resolutionsDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('serves stale cache when registry is unreachable', async () => {
    // Pre-populate the resolutions cache with a known entry for the 'latest' tag.
    await writeResolution(resolutionsDir, 'lodash', 'latest', {
      host: 'github.com', org: 'lodash', repo: 'lodash', ref: 'stale-sha-1234',
    })

    // Make the entry "stale" by manipulating its resolvedAt to be ancient.
    const path = join(resolutionsDir, 'npm', 'lodash', 'latest.json')
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    parsed.resolvedAt = 0
    await writeFile(path, JSON.stringify(parsed))

    // Mock fetch to fail with a network-style error.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed: getaddrinfo ENOTFOUND registry.npmjs.org'),
    )

    const result = await resolveNpm(
      { source: 'npm', name: 'lodash' },
      { resolutionsDir },
    )
    expect(result.ref).toBe('stale-sha-1234')
    expect(result.org).toBe('lodash')
    expect(result.repo).toBe('lodash')
  })

  it('propagates error when no stale entry exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed'),
    )
    await expect(
      resolveNpm({ source: 'npm', name: 'lodash', version: '99.99.99' }, { resolutionsDir }),
    ).rejects.toThrow(/fetch failed/)
  })
})
