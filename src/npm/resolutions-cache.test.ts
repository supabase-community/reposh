import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readResolution, writeResolution } from './resolutions-cache.js'

describe('resolutions-cache', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reposh-resolutions-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns undefined when no resolution exists', async () => {
    expect(await readResolution(dir, 'lodash', '4.17.21')).toBeUndefined()
  })

  it('writes and reads a pinned resolution', async () => {
    await writeResolution(dir, 'lodash', '4.17.21', {
      host: 'github.com', org: 'lodash', repo: 'lodash', ref: 'abc123',
    })
    const got = await readResolution(dir, 'lodash', '4.17.21')
    expect(got).toMatchObject({
      host: 'github.com', org: 'lodash', repo: 'lodash', ref: 'abc123',
    })
    expect(got?.resolvedAt).toBeTypeOf('number')
  })

  it('handles scoped names', async () => {
    await writeResolution(dir, '@types/node', '20.0.0', {
      host: 'github.com', org: 'DefinitelyTyped', repo: 'DefinitelyTyped', ref: 'def456',
    })
    const got = await readResolution(dir, '@types/node', '20.0.0')
    expect(got).toMatchObject({ org: 'DefinitelyTyped' })
  })

  it('returns pinned resolution regardless of age (no TTL)', async () => {
    await writeResolution(dir, 'lodash', '4.17.21', {
      host: 'github.com', org: 'lodash', repo: 'lodash', ref: 'abc',
    })
    // No maxAgeMs means pinned skips the TTL check entirely
    expect(await readResolution(dir, 'lodash', '4.17.21', { maxAgeMs: 0 })).toBeDefined()
  })

  it('honors maxAgeMs for dist-tag resolutions', async () => {
    await writeResolution(dir, 'lodash', 'latest', {
      host: 'github.com', org: 'lodash', repo: 'lodash', ref: 'abc',
    })
    // Fresh: returns the entry
    expect(await readResolution(dir, 'lodash', 'latest', { maxAgeMs: 60_000 })).toBeDefined()
    // Force "ancient" by passing 0 max age
    expect(await readResolution(dir, 'lodash', 'latest', { maxAgeMs: 0 })).toBeUndefined()
  })

  it('round-trips scoped packages in nested paths', async () => {
    await writeResolution(dir, '@vercel/edge', 'latest', {
      host: 'github.com', org: 'vercel', repo: 'edge', ref: 'xyz',
    })
    // File should live at <dir>/npm/@vercel/edge/latest.json
    const path = join(dir, 'npm', '@vercel', 'edge', 'latest.json')
    await expect(stat(path)).resolves.toBeDefined()
    expect(await readResolution(dir, '@vercel/edge', 'latest')).toBeDefined()
  })
})
