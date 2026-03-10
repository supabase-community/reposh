import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(async () => {}),
}))

vi.mock('./paths.js', () => ({
  CACHE_DIR: '/tmp/reposh-test-cache',
}))

import { cacheLs, cacheRm, findCachedRepos, formatSize } from './cache-commands.js'
import { readdir, stat, rm } from 'node:fs/promises'

const mockReaddir = vi.mocked(readdir)
const mockStat = vi.mocked(stat)
const mockRm = vi.mocked(rm)

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
    mockStat.mockResolvedValueOnce(fileStat(1024))

    const repos = await findCachedRepos()
    expect(repos).toEqual([{
      host: 'github.com',
      org: 'facebook',
      repo: 'react',
      path: join(CACHE_DIR, 'github.com', 'facebook', 'react'),
      sizeBytes: 1024,
    }])
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
    mockStat.mockResolvedValueOnce(fileStat(2048))

    await cacheLs()
    expect(console.log).toHaveBeenCalledWith('facebook/react  2.0 KB')
    expect(console.log).toHaveBeenCalledWith('\n1 repo, 2.0 KB total')
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
    mockStat.mockResolvedValueOnce(fileStat(100))

    await cacheRm(undefined, true)
    expect(mockRm).toHaveBeenCalledWith(CACHE_DIR, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed 1 repo from cache.')
  })

  it('prints message when --all on empty cache', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))
    await cacheRm(undefined, true)
    expect(mockRm).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Cache is already empty.')
  })

  it('removes a specific repo', async () => {
    const dir = join(CACHE_DIR, 'github.com', 'facebook', 'react')
    mockStat.mockResolvedValueOnce(dirStat()) // exists check

    await cacheRm('facebook/react')
    expect(mockRm).toHaveBeenCalledWith(dir, { recursive: true, force: true })
    expect(console.log).toHaveBeenCalledWith('Removed facebook/react')
  })

  it('throws for invalid repo target', async () => {
    await expect(cacheRm('not-valid')).rejects.toThrow('Invalid repo: not-valid')
  })

  it('throws when repo is not in cache', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT')) // doesn't exist

    await expect(cacheRm('facebook/react')).rejects.toThrow('Not in cache: facebook/react')
  })
})
