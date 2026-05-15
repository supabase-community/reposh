import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
  rm: vi.fn(async () => {}),
}))

vi.mock('../repo-cache.js', () => ({
  listCachedRepos: vi.fn(async () => []),
  removeCachedRepo: vi.fn(async () => {}),
}))

import { cacheLs, cacheRm, formatSize } from './cache.js'
import { listCachedRepos, removeCachedRepo } from '../repo-cache.js'
import { readdir, stat, lstat, rm } from 'node:fs/promises'

const mockReaddir = vi.mocked(readdir)
const mockStat = vi.mocked(stat)
const mockLstat = vi.mocked(lstat)
const mockRm = vi.mocked(rm)
const mockListCachedRepos = vi.mocked(listCachedRepos)
const mockRemoveCachedRepo = vi.mocked(removeCachedRepo)

const CACHE_DIR = '/tmp/reposh-test-cache'

function dirEntry(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as any
}

function fileStat(size: number) {
  return { size, isDirectory: () => false } as any
}

function dirStat() {
  return { isDirectory: () => true } as any
}

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })
})

describe('listCachedRepos (via cacheLs)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prints message when cache is empty', async () => {
    mockListCachedRepos.mockResolvedValueOnce([])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cacheLs(CACHE_DIR)
    expect(console.log).toHaveBeenCalledWith('No cached repos.')
  })

  it('prints repos with sizes and total', async () => {
    mockListCachedRepos.mockResolvedValueOnce([{
      host: 'github.com', org: 'facebook', repo: 'react',
      path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
      sizeBytes: 2048,
    }])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cacheLs(CACHE_DIR)
    expect(console.log).toHaveBeenCalledWith('facebook/react  2.0 KB')
    expect(console.log).toHaveBeenCalledWith('\n1 entry, 2.0 KB total')
  })

  it('lists worktrees with (worktree) suffix', async () => {
    mockListCachedRepos.mockResolvedValueOnce([
      {
        host: 'github.com', org: 'facebook', repo: 'react',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
        sizeBytes: 2048,
      },
      {
        host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react@v18.2.0'),
        sizeBytes: 1024,
      },
    ])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await cacheLs(CACHE_DIR)

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    expect(calls[0]).toMatch(/^facebook\/react\s+2\.0 KB$/)
    expect(calls[1]).toMatch(/^facebook\/react@v18\.2\.0\s+1\.0 KB\s+\(worktree\)$/)
    expect(calls[2]).toBe('\n2 entries, 3.0 KB total')
  })
})

describe('cacheRm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('throws when no repo and no --all', async () => {
    await expect(cacheRm(CACHE_DIR)).rejects.toThrow('Specify a repo to remove')
  })

  it('removes all repos with --all', async () => {
    mockListCachedRepos.mockResolvedValueOnce([{
      host: 'github.com', org: 'facebook', repo: 'react',
      path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
      sizeBytes: 100,
    }])

    await cacheRm(CACHE_DIR, { all: true, skipConfirm: true })
    expect(mockRm).toHaveBeenCalledWith(CACHE_DIR, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed 1 entry from cache.')
  })

  it('prints message when --all on empty cache', async () => {
    mockListCachedRepos.mockResolvedValueOnce([])
    await cacheRm(CACHE_DIR, { all: true })
    expect(mockRm).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Cache is already empty.')
  })

  it('removes a specific repo', async () => {
    mockListCachedRepos.mockResolvedValueOnce([{
      host: 'github.com', org: 'facebook', repo: 'react',
      path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
      sizeBytes: 1024,
    }])

    await cacheRm(CACHE_DIR, { repo: 'facebook/react', skipConfirm: true })
    expect(mockRemoveCachedRepo).toHaveBeenCalledWith(CACHE_DIR, {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react',
    })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react')
  })

  it('throws for invalid repo target', async () => {
    await expect(cacheRm(CACHE_DIR, { repo: 'not-valid' })).rejects.toThrow('Invalid repo: not-valid')
  })

  it('throws when repo is not in cache', async () => {
    mockListCachedRepos.mockResolvedValueOnce([])
    await expect(cacheRm(CACHE_DIR, { repo: 'facebook/react' })).rejects.toThrow('Not in cache: facebook/react')
  })

  it('removes a single worktree', async () => {
    mockListCachedRepos.mockResolvedValueOnce([
      {
        host: 'github.com', org: 'facebook', repo: 'react',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
        sizeBytes: 1024,
      },
      {
        host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react@v18.2.0'),
        sizeBytes: 512,
      },
    ])

    await cacheRm(CACHE_DIR, { repo: 'facebook/react:v18.2.0', skipConfirm: true })
    expect(mockRemoveCachedRepo).toHaveBeenCalledWith(CACHE_DIR, {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react@v18.2.0')
  })

  it('throws when worktree is not in cache', async () => {
    mockListCachedRepos.mockResolvedValueOnce([])
    await expect(cacheRm(CACHE_DIR, { repo: 'facebook/react:v18.2.0' })).rejects.toThrow('Not in cache: facebook/react:v18.2.0')
  })

  it('removes main repo and cascades to worktrees', async () => {
    mockListCachedRepos.mockResolvedValueOnce([
      {
        host: 'github.com', org: 'facebook', repo: 'react',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
        sizeBytes: 1024,
      },
      {
        host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react@v18.2.0'),
        sizeBytes: 512,
      },
      {
        host: 'github.com', org: 'facebook', repo: 'react', ref: 'canary',
        path: join(CACHE_DIR, 'github.com', 'facebook', 'react@canary'),
        sizeBytes: 512,
      },
    ])

    await cacheRm(CACHE_DIR, { repo: 'facebook/react', skipConfirm: true })

    // Should remove each worktree then the main repo
    expect(mockRemoveCachedRepo).toHaveBeenCalledTimes(3)
    expect(mockRemoveCachedRepo).toHaveBeenCalledWith(CACHE_DIR, {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
    expect(mockRemoveCachedRepo).toHaveBeenCalledWith(CACHE_DIR, {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'canary',
    })
    expect(mockRemoveCachedRepo).toHaveBeenCalledWith(CACHE_DIR, {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react',
    })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react (3 entries)')
  })

  it('delegates with ref for worktree removal', async () => {
    mockListCachedRepos.mockResolvedValueOnce([{
      host: 'github.com', org: 'facebook', repo: 'react', ref: 'feature/hooks',
      path: join(CACHE_DIR, 'github.com', 'facebook', 'react@feature~hooks'),
      sizeBytes: 256,
    }])

    await cacheRm(CACHE_DIR, { repo: 'facebook/react:feature/hooks', skipConfirm: true })

    expect(mockRemoveCachedRepo).toHaveBeenCalledWith(CACHE_DIR, {
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'feature/hooks',
    })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react@feature/hooks')
  })
})
