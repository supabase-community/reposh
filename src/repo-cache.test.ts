import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { spawn as realSpawn } from 'node:child_process'
import type { RepoTarget } from './parse-target.js'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  stat: vi.fn(async () => { throw new Error('ENOENT') }),
}))

// Mock paths to use a temp dir
vi.mock('./paths.js', () => ({
  CACHE_DIR: '/tmp/reposh-test-cache',
}))

const expectedDir = resolve('/tmp/reposh-test-cache', 'github.com', 'facebook', 'react')

import { ensureRepo } from './repo-cache.js'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

const mockSpawn = vi.mocked(spawn)
const mockStat = vi.mocked(stat)

function fakeProc(exitCode = 0) {
  const proc = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0)
      return proc
    }),
    stderr: {
      on: vi.fn(),
    },
  }
  return proc as unknown as ReturnType<typeof realSpawn>
}

const target: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react' }

describe('ensureRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clones when repo does not exist', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(target)

    expect(dir).toBe(expectedDir)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth=1', '--single-branch', 'https://github.com/facebook/react', dir],
      expect.any(Object),
    )
  })

  it('returns cached dir when repo is fresh', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1000 } as any)

    const dir = await ensureRepo(target)

    expect(dir).toBe(expectedDir)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('fetch+resets when repo is stale', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 600_000 } as any)
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(target)

    expect(dir).toBe(expectedDir)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['fetch', '--depth=1', 'origin'],
      expect.any(Object),
    )
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'FETCH_HEAD'],
      expect.any(Object),
    )
  })

  it('serves stale cache when refresh fails', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 600_000 } as any)
    mockSpawn.mockReturnValue(fakeProc(1))

    const messages: string[] = []
    const dir = await ensureRepo(target, (msg) => messages.push(msg))

    expect(dir).toBe(expectedDir)
    expect(messages).toContain('Refresh failed, using stale cache\n')
  })

  it('skips reset when fetch fails', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 600_000 } as any)
    mockSpawn.mockReturnValue(fakeProc(1))

    await ensureRepo(target, () => {})

    // Only fetch was attempted, reset was never called
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['fetch', '--depth=1', 'origin'],
      expect.any(Object),
    )
  })

  it('reports progress during clone', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const messages: string[] = []
    await ensureRepo(target, (msg) => messages.push(msg))

    expect(messages).toContain('Cloning facebook/react...\n')
  })
})
