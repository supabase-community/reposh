import { mkdir, stat } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { repoLabel } from './parse-target.js'
import type { RepoTarget } from './parse-target.js'
import { CACHE_DIR } from './paths.js'
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS ?? '300000', 10)

// Per-repo and per-ref locks to prevent concurrent clones/pulls
const locks = new Map<string, Promise<void>>()

function cacheKey(target: RepoTarget): string {
  const base = `${target.host}/${target.org}/${target.repo}`
  return target.ref ? `${base}@${target.ref}` : base
}

function repoDir(target: RepoTarget): string {
  return resolve(CACHE_DIR, target.host, target.org, target.repo)
}

// Encode ref for use in filesystem directory name (/ -> --)
export function encodeRef(ref: string): string {
  return ref.replace(/\//g, '--')
}

function worktreeDir(target: RepoTarget): string {
  return resolve(CACHE_DIR, target.host, target.org, `${target.repo}@${encodeRef(target.ref!)}`)
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

// Worktrees use a .git file (not dir) pointing to the main repo.
// Check mtime of the worktree directory itself as a staleness proxy.
async function worktreeAgeMs(dir: string): Promise<number> {
  try {
    const s = await stat(join(dir, '.git'))
    return Date.now() - s.mtimeMs
  } catch {}
  return Infinity
}

function runGit(
  args: string[],
  opts: { cwd?: string; onStderr?: (chunk: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'ignore', opts.onStderr ? 'pipe' : 'ignore'],
    })
    if (opts.onStderr) {
      proc.stderr!.on('data', (chunk: Buffer) => opts.onStderr!(chunk.toString()))
    }
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`git ${args[0]} exited with code ${code}`)),
    )
    proc.on('error', reject)
  })
}

async function cloneRepo(
  target: RepoTarget,
  dir: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  onProgress?.(`Cloning ${target.org}/${target.repo}...\n`)
  await runGit(
    ['clone', '--depth=1', '--single-branch',
      `https://${target.host}/${target.org}/${target.repo}`, dir],
    { onStderr: onProgress },
  )
}

// Fetch + reset handles force pushes without needing to re-clone
async function refreshRepo(dir: string): Promise<void> {
  await runGit(['fetch', '--depth=1', 'origin'], { cwd: dir })
  await runGit(['reset', '--hard', 'FETCH_HEAD'], { cwd: dir })
}

// Ensure the main clone (default branch) exists and is fresh
async function ensureMainClone(
  target: RepoTarget,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const baseTarget: RepoTarget = { host: target.host, org: target.org, repo: target.repo }
  const key = cacheKey(baseTarget)
  const dir = repoDir(baseTarget)

  const inflight = locks.get(key)
  if (inflight) {
    onProgress?.(`Waiting for in-progress clone of ${baseTarget.org}/${baseTarget.repo}...\n`)
    await inflight
    return dir
  }

  const age = await repoAgeMs(dir)
  if (age < CACHE_TTL_MS) return dir

  const work = age === Infinity
    ? cloneRepo(baseTarget, dir, onProgress)
    : refreshRepo(dir).catch(() => onProgress?.('Refresh failed, using stale cache\n'))

  locks.set(key, work.finally(() => locks.delete(key)))
  await locks.get(key)!
  return dir
}

// Ensure a worktree exists for a specific ref
async function ensureWorktree(
  target: RepoTarget,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const key = cacheKey(target)
  const wtDir = worktreeDir(target)
  const label = repoLabel(target)

  const inflight = locks.get(key)
  if (inflight) {
    onProgress?.(`Waiting for in-progress setup of ${label}...\n`)
    await inflight
    return wtDir
  }

  const age = await worktreeAgeMs(wtDir)
  if (age < CACHE_TTL_MS) return wtDir

  const work = (async () => {
    // Ensure the main clone exists (we need its object store)
    const mainDir = await ensureMainClone(target, onProgress)

    onProgress?.(`Fetching ${label}...\n`)
    try {
      await runGit(['fetch', '--depth=1', 'origin', target.ref!], { cwd: mainDir, onStderr: onProgress })
    } catch {
      throw new Error(`Branch or tag '${target.ref}' not found in ${target.org}/${target.repo}`)
    }

    if (age === Infinity) {
      // New worktree
      await mkdir(dirname(wtDir), { recursive: true })
      await runGit(['worktree', 'add', wtDir, 'FETCH_HEAD', '--detach'], { cwd: mainDir })
    } else {
      // Stale worktree - update it
      await runGit(['-C', wtDir, 'checkout', '--detach', 'FETCH_HEAD'], {})
    }
  })()

  locks.set(key, work.finally(() => locks.delete(key)))
  await locks.get(key)!
  return wtDir
}

export async function ensureRepo(
  target: RepoTarget,
  onProgress?: (msg: string) => void,
): Promise<string> {
  if (target.ref) {
    return ensureWorktree(target, onProgress)
  }
  return ensureMainClone(target, onProgress)
}
