import { rm, mkdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { promises as fs } from 'node:fs'
import type { RepoTarget } from './parse-target.js'

const CACHE_DIR = resolve(process.env.CACHE_DIR ?? '/tmp/repo-cache')
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS ?? '300000', 10)

// Per-repo locks to prevent concurrent clones/pulls
const locks = new Map<string, Promise<void>>()

function cacheKey(target: RepoTarget): string {
  return `${target.host}/${target.org}/${target.repo}`
}

function repoDir(target: RepoTarget): string {
  return resolve(CACHE_DIR, target.host, target.org, target.repo)
}

// Returns age in ms using FETCH_HEAD mtime (written on every pull),
// falling back to HEAD. Returns Infinity if repo doesn't exist yet.
async function repoAgeMs(dir: string): Promise<number> {
  for (const file of ['.git/FETCH_HEAD', '.git/HEAD']) {
    try {
      const s = await stat(join(dir, file))
      return Date.now() - s.mtimeMs
    } catch {}
  }
  return Infinity
}

async function cloneRepo(
  target: RepoTarget,
  dir: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  onProgress?.(`\r\x1b[KCloning ${target.org}/${target.repo}: not cached, fetching...`)
  let lastProgressAt = Date.now()
  const heartbeat = onProgress
    ? setInterval(() => {
        const s = Math.round((Date.now() - lastProgressAt) / 1000)
        if (s >= 2) onProgress(`\r\x1b[KCloning ${target.org}/${target.repo}... (${s}s)`)
      }, 1000)
    : undefined

  try {
    await git.clone({
      fs,
      http,
      dir,
      url: `https://${target.host}/${target.org}/${target.repo}`,
      singleBranch: true,
      depth: 1,
      onProgress: onProgress
        ? ({ phase, loaded, total }) => {
            lastProgressAt = Date.now()
            const suffix = total ? ` (${loaded}/${total})` : loaded ? ` (${loaded})` : ''
            onProgress(`\r\x1b[KCloning ${target.org}/${target.repo}: ${phase}${suffix}`)
          }
        : undefined,
    })
  } finally {
    clearInterval(heartbeat)
  }
  onProgress?.('\n')
}

async function pullRepo(dir: string): Promise<void> {
  await git.pull({
    fs,
    http,
    dir,
    singleBranch: true,
    fastForwardOnly: true,
    author: { name: 'cache', email: 'cache' },
  })
}

export async function ensureRepo(
  target: RepoTarget,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const key = cacheKey(target)
  const dir = repoDir(target)

  // If a clone/pull is already in flight, wait for it
  const inflight = locks.get(key)
  if (inflight) {
    onProgress?.(`Waiting for in-progress clone of ${target.org}/${target.repo}...\n`)
    await inflight
    return dir
  }

  const age = await repoAgeMs(dir)

  // Within TTL - already fresh
  if (age < CACHE_TTL_MS) return dir

  const work = age === Infinity
    ? cloneRepo(target, dir, onProgress)                              // never cloned
    : pullRepo(dir).catch(() => cloneRepo(target, dir, onProgress))   // stale - pull, re-clone if pull fails

  locks.set(key, work.finally(() => locks.delete(key)))
  await locks.get(key)!
  return dir
}
