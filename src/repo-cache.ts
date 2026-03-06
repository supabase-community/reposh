import { rm, mkdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { RepoTarget } from './parse-target.js'
import { CACHE_DIR } from './paths.js'
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
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  onProgress?.(`Cloning ${target.org}/${target.repo}...\n`)
  await runGit(
    ['clone', '--depth=1', '--single-branch',
      `https://${target.host}/${target.org}/${target.repo}`, dir],
    { onStderr: onProgress },
  )
}

async function pullRepo(dir: string): Promise<void> {
  await runGit(['pull', '--ff-only'], { cwd: dir })
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
