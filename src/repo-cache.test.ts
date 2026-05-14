import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve, join } from 'node:path'
import { spawn as realSpawn } from 'node:child_process'
import type { RepoTarget } from './types.js'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  stat: vi.fn(async () => { throw new Error('ENOENT') }),
  readdir: vi.fn(async () => []),
  lstat: vi.fn(async () => ({ size: 100 })),
}))

const TEST_CACHE_DIR = '/tmp/reposh-test-cache'
const TEST_CONFIG = { cacheDir: TEST_CACHE_DIR, cacheTtl: 300_000 }
const expectedDir = resolve(TEST_CACHE_DIR, 'github.com', 'facebook', 'react')

import { ensureRepo, encodeRef, listCachedRepos, createRepoCache } from './repo-cache.js'
import { spawn } from 'node:child_process'
import { stat, readdir, lstat } from 'node:fs/promises'
import { checkAllowlist } from './allowlist.js'

vi.mock('./allowlist.js', () => ({
  checkAllowlist: vi.fn(),
}))

const mockSpawn = vi.mocked(spawn)
const mockStat = vi.mocked(stat)
const mockReaddir = vi.mocked(readdir)
const mockLstat = vi.mocked(lstat)

function fakeProc(exitCode = 0, stderrData?: string) {
  const proc = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0)
      return proc
    }),
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderrData) {
          setTimeout(() => cb(Buffer.from(stderrData)), 0)
        }
      }),
    },
  }
  return proc as unknown as ReturnType<typeof realSpawn>
}

const target: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react' }

describe('encodeRef', () => {
  it('encodes slashes', () => {
    expect(encodeRef('feature/hooks')).toBe('feature~hooks')
  })

  it('leaves refs without slashes unchanged', () => {
    expect(encodeRef('main')).toBe('main')
  })

  it('handles multiple slashes', () => {
    expect(encodeRef('a/b/c')).toBe('a~b~c')
  })

  it('preserves double hyphens in ref names', () => {
    // This is the critical case: refs with -- must not collide
    expect(encodeRef('feature--test')).toBe('feature--test')
  })

  it('preserves @ in monorepo-style tags', () => {
    expect(encodeRef('ai@6.0.139')).toBe('ai@6.0.139')
  })

  it('encodes slashes but preserves @ in scoped tags', () => {
    expect(encodeRef('@scope/pkg@1.0.0')).toBe('@scope~pkg@1.0.0')
  })
})

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

    const dir = await ensureRepo(target, TEST_CONFIG)

    expect(dir).toBe(expectedDir)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth=1', '--single-branch', 'https://github.com/facebook/react', dir],
      expect.any(Object),
    )
  })

  it('returns cached dir when repo is fresh', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1000 } as any)

    const dir = await ensureRepo(target, TEST_CONFIG)

    expect(dir).toBe(expectedDir)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('fetch+resets when repo is stale', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 600_000 } as any)
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(target, TEST_CONFIG)

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

  it('serves stale cache when refresh fails and includes error detail', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 600_000 } as any)
    mockSpawn.mockReturnValue(fakeProc(1, 'fatal: could not read from remote'))

    const messages: string[] = []
    const dir = await ensureRepo(target, TEST_CONFIG, (msg) => messages.push(msg))

    expect(dir).toBe(expectedDir)
    expect(messages.some(m => m.includes('Refresh failed') && m.includes('fatal: could not read from remote'))).toBe(true)
  })

  it('skips reset when fetch fails', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 600_000 } as any)
    mockSpawn.mockReturnValue(fakeProc(1))

    await ensureRepo(target, TEST_CONFIG, () => {})

    // Only fetch was attempted, reset was never called
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['fetch', '--depth=1', 'origin'],
      expect.any(Object),
    )
  })

  it('includes stderr in clone error message', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(128, 'fatal: repository not found'))

    await expect(ensureRepo(target, TEST_CONFIG)).rejects.toThrow(
      'git clone exited with code 128: fatal: repository not found',
    )
  })

  it('reports progress during clone', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const messages: string[] = []
    await ensureRepo(target, TEST_CONFIG, (msg) => messages.push(msg))

    expect(messages).toContain('Cloning facebook/react...\n')
  })
})

describe('ensureRepo with ref (worktrees)', () => {
  const targetWithRef: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0' }
  const expectedWtDir = resolve(TEST_CACHE_DIR, 'github.com', 'facebook', 'react@v18.2.0')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clones main repo then creates worktree for ref', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(targetWithRef, TEST_CONFIG)

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
    const expectedSlashDir = resolve(TEST_CACHE_DIR, 'github.com', 'facebook', 'react@feature~hooks')

    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(slashRef, TEST_CONFIG)

    expect(dir).toBe(expectedSlashDir)
  })

  it('re-fetches and checks out stale worktree', async () => {
    // Worktree .git file exists but is stale (10 min old)
    // Main repo FETCH_HEAD is fresh (1 sec old)
    mockStat.mockImplementation(async (p: any) => {
      const path = String(p)
      if (path.includes('react@v18.2.0')) {
        // worktreeAgeMs -> stale .git file
        return { mtimeMs: Date.now() - 600_000 } as any
      }
      // ensureMainClone -> repoAgeMs checks FETCH_HEAD/HEAD, return fresh
      return { mtimeMs: Date.now() - 1000 } as any
    })
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(targetWithRef, TEST_CONFIG)

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

    const dir = await ensureRepo(targetWithRef, TEST_CONFIG)

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

    await expect(ensureRepo(badRef, TEST_CONFIG)).rejects.toThrow(
      "Branch or tag 'nonexistent-branch' not found in facebook/react",
    )
  })

  it('default branch uses original cache dir (no worktree)', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const dir = await ensureRepo(target, TEST_CONFIG)

    expect(dir).toBe(expectedDir)
    // Should not use worktree commands
    const allArgs = mockSpawn.mock.calls.map(c => c[1])
    expect(allArgs.some(a => a.includes('worktree'))).toBe(false)
  })
})

describe('createRepoCache', () => {
  const mockCheckAllowlist = vi.mocked(checkAllowlist)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('resolves string target to RepoTarget', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const cache = createRepoCache({ cacheDir: TEST_CACHE_DIR })
    const dir = await cache.ensureRepo('facebook/react')

    expect(dir).toBe(expectedDir)
  })

  it('accepts RepoTarget object directly', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    mockSpawn.mockReturnValue(fakeProc(0))

    const cache = createRepoCache({ cacheDir: TEST_CACHE_DIR })
    const dir = await cache.ensureRepo(target)

    expect(dir).toBe(expectedDir)
  })

  it('throws on invalid string target', async () => {
    const cache = createRepoCache({ cacheDir: TEST_CACHE_DIR })
    await expect(cache.ensureRepo('invalid')).rejects.toThrow('Invalid repo target: invalid')
  })

  it('checks allowlist before cloning', async () => {
    mockCheckAllowlist.mockImplementation(() => {
      throw new Error('Access denied: github.com/evil/repo')
    })

    const cache = createRepoCache({
      cacheDir: TEST_CACHE_DIR,
      allowlist: [{ host: 'github.com', org: 'allowed' }],
    })

    await expect(cache.ensureRepo('evil/repo')).rejects.toThrow('Access denied')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('force option bypasses TTL', async () => {
    // Return a fresh repo (1 second old)
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1000 } as any)
    mockSpawn.mockReturnValue(fakeProc(0))

    const cache = createRepoCache({ cacheDir: TEST_CACHE_DIR, cacheTtl: 300_000 })

    // Without force: should use cache
    await cache.ensureRepo(target)
    expect(mockSpawn).not.toHaveBeenCalled()

    // With force: should refresh
    await cache.ensureRepo(target, { force: true })
    expect(mockSpawn).toHaveBeenCalled()
  })
})

describe('listCachedRepos', () => {
  const dirs: Record<string, string[]> = {
    [TEST_CACHE_DIR]: ['github.com'],
    [join(TEST_CACHE_DIR, 'github.com')]: ['vercel'],
    [join(TEST_CACHE_DIR, 'github.com', 'vercel')]: ['ai', 'ai@ai@6.0.139'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockReaddir.mockImplementation((async (p: any) => dirs[String(p)] ?? []) as any)
    mockStat.mockResolvedValue({ isDirectory: () => true } as any)
    mockLstat.mockResolvedValue({ size: 100 } as any)
  })

  it('parses directory with @ in ref correctly (monorepo tags)', async () => {
    const repos = await listCachedRepos(TEST_CACHE_DIR)

    expect(repos.find(r => !r.ref)).toEqual(expect.objectContaining({
      host: 'github.com', org: 'vercel', repo: 'ai',
    }))
    expect(repos.find(r => r.ref)).toEqual(expect.objectContaining({
      host: 'github.com', org: 'vercel', repo: 'ai', ref: 'ai@6.0.139',
    }))
  })
})
