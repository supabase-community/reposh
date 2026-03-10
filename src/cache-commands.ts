import { createInterface } from 'node:readline'
import { readdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { CACHE_DIR } from './paths.js'
import { parseRepoTarget, repoLabel } from './parse-target.js'
import { encodeRef } from './repo-cache.js'

interface CachedRepo {
  host: string
  org: string
  repo: string
  ref?: string
  path: string
  sizeBytes: number
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await dirSize(full)
    } else {
      total += (await stat(full)).size
    }
  }
  return total
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

// Decode ref from filesystem directory name (-- -> /)
function decodeRef(encoded: string): string {
  return encoded.replace(/--/g, '/')
}

export async function findCachedRepos(): Promise<CachedRepo[]> {
  const repos: CachedRepo[] = []
  let hosts: string[]
  try {
    hosts = await readdir(CACHE_DIR)
  } catch {
    return repos
  }

  for (const host of hosts) {
    const hostDir = join(CACHE_DIR, host)
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

async function confirm(message: string): Promise<boolean> {
  if (!(process.stdin.isTTY)) {
    throw new Error('Confirmation required. Use -y to skip.')
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

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

export async function cacheLs(): Promise<void> {
  const repos = await findCachedRepos()
  if (repos.length === 0) {
    console.log('No cached repos.')
    return
  }

  // Sort: main repos first, then worktrees grouped under their parent
  repos.sort((a, b) => {
    const aBase = `${a.host}/${a.org}/${a.repo}`
    const bBase = `${b.host}/${b.org}/${b.repo}`
    if (aBase !== bBase) return aBase.localeCompare(bBase)
    if (!a.ref && b.ref) return -1
    if (a.ref && !b.ref) return 1
    return (a.ref ?? '').localeCompare(b.ref ?? '')
  })

  // Find max label length for alignment
  const labels = repos.map(r => repoLabel(r))
  const maxLen = Math.max(...labels.map(l => l.length))

  for (let i = 0; i < repos.length; i++) {
    const r = repos[i]
    const label = labels[i].padEnd(maxLen + 2)
    const suffix = r.ref ? '  (worktree)' : ''
    console.log(`${label}${formatSize(r.sizeBytes)}${suffix}`)
  }

  const total = repos.reduce((sum, r) => sum + r.sizeBytes, 0)
  console.log(`\n${repos.length} entr${repos.length === 1 ? 'y' : 'ies'}, ${formatSize(total)} total`)
}

export async function cacheRm(opts: { repo?: string; all?: boolean; skipConfirm?: boolean } = {}): Promise<void> {
  const { repo, all, skipConfirm } = opts
  if (!repo && !all) {
    throw new Error('Specify a repo to remove, or use --all to clear the entire cache')
  }

  if (all) {
    const repos = await findCachedRepos()
    if (repos.length === 0) {
      console.log('Cache is already empty.')
      return
    }
    const total = repos.reduce((sum, r) => sum + r.sizeBytes, 0)
    if (!skipConfirm) {
      const ok = await confirm(`Remove all cached repos (${repos.length} entr${repos.length === 1 ? 'y' : 'ies'}, ${formatSize(total)})?`)
      if (!ok) return
    }
    await rm(CACHE_DIR, { recursive: true, force: true })
    console.log(`Removed ${repos.length} entr${repos.length === 1 ? 'y' : 'ies'} from cache.`)
    return
  }

  const target = parseRepoTarget(repo!)
  if (!target) {
    throw new Error(`Invalid repo: ${repo}`)
  }

  if (target.ref) {
    // Remove a single worktree
    const wtDir = join(CACHE_DIR, target.host, target.org, `${target.repo}@${encodeRef(target.ref)}`)
    const exists = await stat(wtDir).catch(() => null)
    if (!exists) {
      throw new Error(`Not in cache: ${repo}`)
    }

    const label = repoLabel(target)
    if (!skipConfirm) {
      const ok = await confirm(`Remove ${label} (worktree)?`)
      if (!ok) return
    }

    const mainDir = join(CACHE_DIR, target.host, target.org, target.repo)
    await runGitWorktreeRemove(mainDir, wtDir)
    await rm(wtDir, { recursive: true, force: true })
    console.log(`Removed ${label}`)
    return
  }

  // Remove main clone + all its worktrees
  const mainDir = join(CACHE_DIR, target.host, target.org, target.repo)
  const exists = await stat(mainDir).catch(() => null)
  if (!exists) {
    throw new Error(`Not in cache: ${repo}`)
  }

  // Find worktrees for this repo
  const orgDir = join(CACHE_DIR, target.host, target.org)
  const prefix = `${target.repo}@`
  let worktreeDirs: string[] = []
  try {
    const entries = await readdir(orgDir)
    worktreeDirs = entries.filter(e => e.startsWith(prefix)).map(e => join(orgDir, e))
  } catch {}

  const label = repoLabel(target)

  if (worktreeDirs.length > 0) {
    // Decode worktree labels for display
    const wtLabels = worktreeDirs.map(d => {
      const dirName = d.split('/').pop()!
      const ref = decodeRef(dirName.slice(prefix.length))
      return `  ${label}:${ref}`
    })

    if (!skipConfirm) {
      console.log(`This will also remove ${worktreeDirs.length} worktree${worktreeDirs.length === 1 ? '' : 's'}:`)
      for (const wl of wtLabels) console.log(wl)
      const ok = await confirm(`Remove ${label} and all worktrees?`)
      if (!ok) return
    }

    for (const wtDir of worktreeDirs) {
      await runGitWorktreeRemove(mainDir, wtDir)
      await rm(wtDir, { recursive: true, force: true })
    }
  } else if (!skipConfirm) {
    const ok = await confirm(`Remove ${label}?`)
    if (!ok) return
  }

  await rm(mainDir, { recursive: true, force: true })
  const count = 1 + worktreeDirs.length
  console.log(`Removed ${label}${count > 1 ? ` (${count} entries)` : ''}`)
}
