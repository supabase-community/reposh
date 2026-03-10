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

describe('ensureRepo with ref (worktrees)', () => {
  const targetWithRef: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0' }
  const expectedWtDir = resolve('/tmp/reposh-test-cache', 'github.com', 'facebook', 'react@v18.2.0')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clones main repo then creates worktree for ref', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(targetWithRef)

    expect(dir).toBe(expectedWtDir)
    // Should clone main repo first
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth=1', '--single-branch', 'https://github.com/facebook/react', expectedDir],
      expect.any(Object),
    )
    // Then fetch the ref
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['fetch', '--depth=1', 'origin', 'v18.2.0'],
      expect.any(Object),
    )
    // Then add worktree
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', expectedWtDir, 'FETCH_HEAD', '--detach'],
      expect.any(Object),
    )
  })

  it('encodes slashes in ref for worktree dir name', async () => {
    const slashRef: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react', ref: 'feature/hooks' }
    const expectedSlashDir = resolve('/tmp/reposh-test-cache', 'github.com', 'facebook', 'react@feature--hooks')

    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(slashRef)

    expect(dir).toBe(expectedSlashDir)
  })

  it('re-fetches and checks out stale worktree', async () => {
    // Worktree .git file exists but is stale (10 min old)
    // Main repo FETCH_HEAD is fresh (1 sec old)
    let statCallCount = 0
    mockStat.mockImplementation(async (p: any) => {
      statCallCount++
      const path = String(p)
      if (path.includes('react@v18.2.0')) {
        // worktreeAgeMs -> stale .git file
        return { mtimeMs: Date.now() - 600_000 } as any
      }
      // ensureMainClone -> repoAgeMs checks FETCH_HEAD/HEAD, return fresh
      return { mtimeMs: Date.now() - 1000 } as any
    })
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(targetWithRef)

    expect(dir).toBe(expectedWtDir)
    // Should fetch the ref
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['fetch', '--depth=1', 'origin', 'v18.2.0'],
      expect.any(Object),
    )
    // Should checkout (not worktree add)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['-C', expectedWtDir, 'checkout', '--detach', 'FETCH_HEAD'],
      expect.any(Object),
    )
    // Should NOT have called worktree add
    const allArgs = mockSpawn.mock.calls.map(c => c[1])
    expect(allArgs.some(a => a.includes('worktree'))).toBe(false)
  })

  it('returns fresh worktree without fetching', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1000 } as any)

    const dir = await ensureRepo(targetWithRef)

    expect(dir).toBe(expectedWtDir)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('throws descriptive error when ref not found', async () => {
    const badRef: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react', ref: 'nonexistent-branch' }

    // First stat call (worktree .git) -> ENOENT (no worktree yet)
    // Second stat calls (main repo) -> ENOENT (no main clone yet)
    mockStat.mockRejectedValue(new Error('ENOENT'))

    // Clone succeeds, then fetch for the bad ref fails
    let callCount = 0
    mockSpawn.mockImplementation(() => {
      callCount++
      // First call is clone (succeeds), second is fetch (fails)
      return fakeProc(callCount === 2 ? 1 : 0)
    })

    await expect(ensureRepo(badRef)).rejects.toThrow(
      "Branch or tag 'nonexistent-branch' not found in facebook/react",
    )
  })

  it('default branch uses original cache dir (no worktree)', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(target)

    expect(dir).toBe(expectedDir)
    // Should not use worktree commands
    const allArgs = mockSpawn.mock.calls.map(c => c[1])
    expect(allArgs.some(a => a.includes('worktree'))).toBe(false)
  })
})
