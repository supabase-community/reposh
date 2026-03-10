import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
  rm: vi.fn(async () => {}),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('./paths.js', () => ({
  CACHE_DIR: '/tmp/reposh-test-cache',
}))

import { cacheLs, cacheRm, findCachedRepos, formatSize } from './cache-commands.js'
import { readdir, stat, lstat, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const mockReaddir = vi.mocked(readdir)
const mockStat = vi.mocked(stat)
const mockLstat = vi.mocked(lstat)
const mockRm = vi.mocked(rm)
const mockSpawn = vi.mocked(spawn)

function fakeProc() {
  const proc = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(0), 0)
      return proc
    }),
  }
  return proc as unknown as ReturnType<typeof spawn>
}

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

describe('findCachedRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when cache dir does not exist', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))
    const repos = await findCachedRepos()
    expect(repos).toEqual([])
  })

  it('finds repos in the cache', async () => {
    // CACHE_DIR -> hosts
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat()) // github.com is dir

    // github.com -> orgs
    mockReaddir.mockResolvedValueOnce(['facebook'] as any)
    mockStat.mockResolvedValueOnce(dirStat()) // facebook is dir

    // facebook -> repos
    mockReaddir.mockResolvedValueOnce(['react'] as any)
    mockStat.mockResolvedValueOnce(dirStat()) // react is dir

    // dirSize walk for react
    mockReaddir.mockResolvedValueOnce([dirEntry('file.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(1024))

    const repos = await findCachedRepos()
    expect(repos).toEqual([{
      host: 'github.com',
      org: 'facebook',
      repo: 'react',
      path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
      sizeBytes: 1024,
    }])
  })

  it('parses worktree dirs with @ref', async () => {
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['facebook'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['react', 'react@v18.2.0'] as any)
    // react dir
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('f.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(1024))
    // react@v18.2.0 dir
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('f.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(512))

    const repos = await findCachedRepos()
    expect(repos).toEqual([
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
  })

  it('decodes -- back to / in ref names', async () => {
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['facebook'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['react@feature--hooks'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('f.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(256))

    const repos = await findCachedRepos()
    expect(repos).toHaveLength(1)
    expect(repos[0].ref).toBe('feature/hooks')
  })

  it('handles broken symlinks gracefully via lstat', async () => {
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['someorg'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['somerepo'] as any)
    mockStat.mockResolvedValueOnce(dirStat())

    // dirSize walk: repo contains a regular file and a broken symlink
    // lstat doesn't follow symlinks, so it returns the symlink's own size
    mockReaddir.mockResolvedValueOnce([
      dirEntry('file.txt', false),
      dirEntry('AGENTS.md', false), // broken symlink
    ] as any)
    mockLstat.mockResolvedValueOnce(fileStat(1024)) // file.txt
    mockLstat.mockResolvedValueOnce(fileStat(48)) // symlink itself (small)

    const repos = await findCachedRepos()
    expect(repos).toHaveLength(1)
    expect(repos[0].sizeBytes).toBe(1072) // counts both entries
  })

  it('skips non-directory entries', async () => {
    mockReaddir.mockResolvedValueOnce(['github.com', 'random-file'] as any)
    mockStat.mockResolvedValueOnce(dirStat()) // github.com is dir
    mockReaddir.mockResolvedValueOnce([] as any) // no orgs
    mockStat.mockResolvedValueOnce(fileStat(100)) // random-file is not dir

    const repos = await findCachedRepos()
    expect(repos).toEqual([])
  })
})

describe('cacheLs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prints message when cache is empty', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))
    await cacheLs()
    expect(console.log).toHaveBeenCalledWith('No cached repos.')
  })

  it('prints repos with sizes and total', async () => {
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['facebook'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['react'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('file.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(2048))

    await cacheLs()
    expect(console.log).toHaveBeenCalledWith('facebook/react  2.0 KB')
    expect(console.log).toHaveBeenCalledWith('\n1 entry, 2.0 KB total')
  })

  it('lists worktrees with (worktree) suffix', async () => {
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['facebook'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['react', 'react@v18.2.0'] as any)
    // react
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('f.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(2048))
    // react@v18.2.0
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('f.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(1024))

    await cacheLs()

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    // Main repo listed first, worktree second with suffix
    expect(calls[0]).toMatch(/^facebook\/react\s+2\.0 KB$/)
    expect(calls[1]).toMatch(/^facebook\/react:v18\.2\.0\s+1\.0 KB\s+\(worktree\)$/)
    expect(calls[2]).toBe('\n2 entries, 3.0 KB total')
  })
})

describe('cacheRm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('throws when no repo and no --all', async () => {
    await expect(cacheRm()).rejects.toThrow('Specify a repo to remove')
  })

  it('removes all repos with --all', async () => {
    // findCachedRepos setup
    mockReaddir.mockResolvedValueOnce(['github.com'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['facebook'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce(['react'] as any)
    mockStat.mockResolvedValueOnce(dirStat())
    mockReaddir.mockResolvedValueOnce([dirEntry('f.txt', false)] as any)
    mockLstat.mockResolvedValueOnce(fileStat(100))

    await cacheRm({ all: true, skipConfirm: true })
    expect(mockRm).toHaveBeenCalledWith(CACHE_DIR, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed 1 entry from cache.')
  })

  it('prints message when --all on empty cache', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))
    await cacheRm({ all: true })
    expect(mockRm).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Cache is already empty.')
  })

  it('removes a specific repo', async () => {
    const dir = join(CACHE_DIR, 'github.com', 'facebook', 'react')
    mockStat.mockResolvedValueOnce(dirStat()) // exists check
    mockReaddir.mockResolvedValueOnce([] as any) // worktree scan

    await cacheRm({ repo: 'facebook/react', skipConfirm: true })
    expect(mockRm).toHaveBeenCalledWith(dir, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react')
  })

  it('throws for invalid repo target', async () => {
    await expect(cacheRm({ repo: 'not-valid' })).rejects.toThrow('Invalid repo: not-valid')
  })

  it('throws when repo is not in cache', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT')) // doesn't exist

    await expect(cacheRm({ repo: 'facebook/react' })).rejects.toThrow('Not in cache: facebook/react')
  })

  it('removes a single worktree', async () => {
    const wtDir = join(CACHE_DIR, 'github.com', 'facebook', 'react@v18.2.0')
    const mainDir = join(CACHE_DIR, 'github.com', 'facebook', 'react')
    mockStat.mockResolvedValueOnce(dirStat()) // worktree exists
    mockSpawn.mockReturnValueOnce(fakeProc()) // git worktree remove

    await cacheRm({ repo: 'facebook/react:v18.2.0', skipConfirm: true })

    expect(mockSpawn).toHaveBeenCalledWith(
      'git', ['worktree', 'remove', '--force', wtDir],
      { cwd: mainDir, stdio: 'ignore' },
    )
    expect(mockRm).toHaveBeenCalledWith(wtDir, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react:v18.2.0')
  })

  it('throws when worktree is not in cache', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'))

    await expect(cacheRm({ repo: 'facebook/react:v18.2.0' })).rejects.toThrow('Not in cache: facebook/react:v18.2.0')
  })

  it('removes main repo and cascades to worktrees', async () => {
    const mainDir = join(CACHE_DIR, 'github.com', 'facebook', 'react')
    const wt1 = join(CACHE_DIR, 'github.com', 'facebook', 'react@v18.2.0')
    const wt2 = join(CACHE_DIR, 'github.com', 'facebook', 'react@canary')

    mockStat.mockResolvedValueOnce(dirStat()) // main exists
    mockReaddir.mockResolvedValueOnce(['react', 'react@v18.2.0', 'react@canary', 'other-repo'] as any) // org dir scan
    mockSpawn.mockReturnValue(fakeProc()) // git worktree remove (called twice)

    await cacheRm({ repo: 'facebook/react', skipConfirm: true })

    // Should run git worktree remove for each worktree
    expect(mockSpawn).toHaveBeenCalledWith(
      'git', ['worktree', 'remove', '--force', wt1],
      { cwd: mainDir, stdio: 'ignore' },
    )
    expect(mockSpawn).toHaveBeenCalledWith(
      'git', ['worktree', 'remove', '--force', wt2],
      { cwd: mainDir, stdio: 'ignore' },
    )

    // Should rm worktree dirs + main dir
    expect(mockRm).toHaveBeenCalledWith(wt1, { recursive: true, force: true })
    expect(mockRm).toHaveBeenCalledWith(wt2, { recursive: true, force: true })
    expect(mockRm).toHaveBeenCalledWith(mainDir, { recursive: true, force: true })

    expect(console.log).toHaveBeenCalledWith('Removed facebook/react (3 entries)')
  })

  it('encodes slashes in ref for worktree dir path', async () => {
    const wtDir = join(CACHE_DIR, 'github.com', 'facebook', 'react@feature--hooks')
    mockStat.mockResolvedValueOnce(dirStat()) // worktree exists
    mockSpawn.mockReturnValueOnce(fakeProc())

    await cacheRm({ repo: 'facebook/react:feature/hooks', skipConfirm: true })

    expect(mockRm).toHaveBeenCalledWith(wtDir, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react:feature/hooks')
  })
})
