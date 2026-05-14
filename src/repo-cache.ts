import { mkdir, stat, readdir, lstat, rm } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { parseTarget, resolveTargetSync, formatTarget } from './parse-target.js'
import { resolveTarget } from './resolve-target.js'
import { checkAllowlist } from './allowlist.js'
import { CACHE_DIR, CACHE_TTL } from './constants.js'
import type { Target, GitTarget, RepoCacheConfig, CachedRepo, RepoCache } from './types.js'

// --- encoding ---

// Encode ref for use in filesystem directory name (/ -> ~)
// Uses ~ because it can't appear in validated refs (SAFE_REF)
export function encodeRef(ref: string): string {
  return ref.replace(/\//g, '~')
}

// Decode ref from filesystem directory name (~ -> /)
function decodeRef(encoded: string): string {
  return encoded.replace(/~/g, '/')
}

// --- path helpers ---

function repoDirPath(cacheDir: string, target: GitTarget): string {
  return resolve(cacheDir, target.host, target.org, target.repo)
}

function worktreeDirPath(cacheDir: string, target: GitTarget): string {
  return resolve(cacheDir, target.host, target.org, `${target.repo}@${encodeRef(target.ref!)}`)
}

// --- age checks ---

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

// --- git operations ---

function runGit(
  args: string[],
  opts: { cwd?: string; onStderr?: (chunk: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderrBuf = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text
      opts.onStderr?.(text)
    })
    proc.on('close', (code) => {
      if (code === 0) return resolve()
      const detail = stderrBuf.trim()
      const msg = detail
        ? `git ${args[0]} exited with code ${code}: ${detail}`
        : `git ${args[0]} exited with code ${code}`
      reject(new Error(msg))
    })
    proc.on('error', reject)
  })
}

async function cloneRepo(
  target: GitTarget,
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
  target: GitTarget,
  cacheDir: string,
  cacheTtl: number,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const baseTarget: GitTarget = { source: 'git', host: target.host, org: target.org, repo: target.repo }
  const dir = repoDirPath(cacheDir, baseTarget)

  const age = await repoAgeMs(dir)
  if (age < cacheTtl) return dir

  if (age === Infinity) {
    await cloneRepo(baseTarget, dir, onProgress)
  } else {
    onProgress?.(`Refreshing ${baseTarget.org}/${baseTarget.repo}...\n`)
    await refreshRepo(dir).catch((err) => {
      const detail = err instanceof Error ? err.message : String(err)
      onProgress?.(`Refresh failed, using stale cache: ${detail}\n`)
    })
  }

  return dir
}

// Ensure a worktree exists for a specific ref
async function ensureWorktreeDir(
  target: GitTarget,
  cacheDir: string,
  cacheTtl: number,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const wtDir = worktreeDirPath(cacheDir, target)
  const label = formatTarget(target)

  const age = await worktreeAgeMs(wtDir)
  if (age < cacheTtl) return wtDir

  // Ensure the main clone exists (we need its object store)
  const mainDir = await ensureMainClone(target, cacheDir, cacheTtl, onProgress)

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
    onProgress?.(`Refreshing ${label}...\n`)
    await runGit(['-C', wtDir, 'checkout', '--detach', 'FETCH_HEAD'], {})
  }

  return wtDir
}

export function ensureRepo(
  target: GitTarget,
  config: { cacheDir: string; cacheTtl: number },
  onProgress?: (msg: string) => void,
): Promise<string> {
  return ensureGitRepoInternal(target, config, onProgress)
}

function ensureGitRepoInternal(
  target: GitTarget,
  config: { cacheDir: string; cacheTtl: number },
  onProgress?: (msg: string) => void,
): Promise<string> {
  if (target.ref) {
    return ensureWorktreeDir(target, config.cacheDir, config.cacheTtl, onProgress)
  }
  return ensureMainClone(target, config.cacheDir, config.cacheTtl, onProgress)
}

// --- cache listing ---

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await dirSize(full)
    } else {
      total += (await lstat(full)).size
    }
  }
  return total
}

export async function listCachedRepos(cacheDir: string): Promise<CachedRepo[]> {
  const repos: CachedRepo[] = []
  let hosts: string[]
  try {
    hosts = await readdir(cacheDir)
  } catch {
    return repos
  }

  for (const host of hosts) {
    const hostDir = join(cacheDir, host)
    if (!(await stat(hostDir).catch(() => null))?.isDirectory()) continue

    const orgs = await readdir(hostDir)
    for (const org of orgs) {
      const orgDir = join(hostDir, org)
      if (!(await stat(orgDir).catch(() => null))?.isDirectory()) continue

      const dirNames = await readdir(orgDir)
      for (const dirName of dirNames) {
        const repoPath = join(orgDir, dirName)
        if (!(await stat(repoPath).catch(() => null))?.isDirectory()) continue

        const sizeBytes = await dirSize(repoPath)

        // Parse @ref from directory name
        const atIdx = dirName.indexOf('@')
        if (atIdx !== -1) {
          const repo = dirName.slice(0, atIdx)
          const ref = decodeRef(dirName.slice(atIdx + 1))
          repos.push({ host, org, repo, ref, path: repoPath, sizeBytes })
        } else {
          repos.push({ host, org, repo: dirName, path: repoPath, sizeBytes })
        }
      }
    }
  }

  return repos
}

// --- cache removal ---

function runGitWorktreeRemove(mainDir: string, wtDir: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['worktree', 'remove', '--force', wtDir], {
      cwd: mainDir,
      stdio: 'ignore',
    })
    proc.on('close', () => resolve())
    proc.on('error', () => resolve())
  })
}

export async function removeCachedRepo(cacheDir: string, target: GitTarget): Promise<void> {
  if (target.ref) {
    const wtDir = join(cacheDir, target.host, target.org, `${target.repo}@${encodeRef(target.ref)}`)
    const exists = await stat(wtDir).catch(() => null)
    if (!exists) {
      throw new Error(`Not in cache: ${formatTarget(target)}`)
    }
    const mainDir = join(cacheDir, target.host, target.org, target.repo)
    await runGitWorktreeRemove(mainDir, wtDir)
    await rm(wtDir, { recursive: true, force: true })
    return
  }

  const mainDir = join(cacheDir, target.host, target.org, target.repo)
  const exists = await stat(mainDir).catch(() => null)
  if (!exists) {
    throw new Error(`Not in cache: ${formatTarget(target)}`)
  }

  // Find and remove worktrees for this repo
  const orgDir = join(cacheDir, target.host, target.org)
  const prefix = `${target.repo}@`
  let worktreeDirs: string[] = []
  try {
    const entries = await readdir(orgDir)
    worktreeDirs = entries.filter(e => e.startsWith(prefix)).map(e => join(orgDir, e))
  } catch {}

  for (const wtDir of worktreeDirs) {
    await runGitWorktreeRemove(mainDir, wtDir)
    await rm(wtDir, { recursive: true, force: true })
  }

  await rm(mainDir, { recursive: true, force: true })
}

// --- factory ---

export function createRepoCache(config?: RepoCacheConfig): RepoCache {
  const cacheDir = config?.cacheDir ?? CACHE_DIR
  const cacheTtl = config?.cacheTtl ?? CACHE_TTL
  const allowlist = config?.allowlist

  return {
    async ensureRepo(
      target,
      opts?: { onProgress?: (msg: string) => void; force?: boolean },
    ): Promise<string> {
      const parsed: Target = typeof target === 'string'
        ? (() => {
            const p = parseTarget(target)
            if (!p) throw new Error(`Invalid target: ${target}`)
            return p
          })()
        : target
      const git = await resolveTarget(parsed, { onProgress: opts?.onProgress, force: opts?.force })
      checkAllowlist(git, allowlist)
      const effectiveTtl = opts?.force ? 0 : cacheTtl
      return ensureGitRepoInternal(git, { cacheDir, cacheTtl: effectiveTtl }, opts?.onProgress)
    },

    listRepos: () => listCachedRepos(cacheDir),
    async removeRepo(target: string | GitTarget): Promise<void> {
      const resolved = typeof target === 'string' ? resolveTargetSync(target) : target
      if (resolved.source !== 'git') {
        throw new Error(`removeRepo only accepts git targets`)
      }
      return removeCachedRepo(cacheDir, resolved)
    },
  }
}
