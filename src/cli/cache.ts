import { createInterface } from 'node:readline'
import { rm } from 'node:fs/promises'
import { parseTarget, formatTarget } from '../parse-target.js'
import { listCachedRepos, removeCachedRepo } from '../repo-cache.js'
import type { CachedRepo } from '../types.js'

function formatCachedRepo(r: CachedRepo): string {
  return formatTarget({ source: 'git', host: r.host, org: r.org, repo: r.repo, ...(r.ref && { ref: r.ref }) })
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

export async function cacheLs(cacheDir: string): Promise<void> {
  const repos = await listCachedRepos(cacheDir)
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
  const labels = repos.map(r => formatCachedRepo(r))
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

export async function cacheRm(cacheDir: string, opts: { repo?: string; all?: boolean; skipConfirm?: boolean } = {}): Promise<void> {
  const { repo, all, skipConfirm } = opts
  if (!repo && !all) {
    throw new Error('Specify a repo to remove, or use --all to clear the entire cache')
  }

  if (all) {
    const repos = await listCachedRepos(cacheDir)
    if (repos.length === 0) {
      console.log('Cache is already empty.')
      return
    }
    const total = repos.reduce((sum, r) => sum + r.sizeBytes, 0)
    if (!skipConfirm) {
      const ok = await confirm(`Remove all cached repos (${repos.length} entr${repos.length === 1 ? 'y' : 'ies'}, ${formatSize(total)})?`)
      if (!ok) return
    }
    await rm(cacheDir, { recursive: true, force: true })
    console.log(`Removed ${repos.length} entr${repos.length === 1 ? 'y' : 'ies'} from cache.`)
    return
  }

  const target = parseTarget(repo!)
  if (!target || target.source !== 'git') {
    throw new Error(`Invalid repo: ${repo}`)
  }

  const label = formatTarget(target)

  if (target.ref) {
    // Verify it exists by checking cached repos
    const cached = await listCachedRepos(cacheDir)
    const found = cached.some(r => r.host === target.host && r.org === target.org && r.repo === target.repo && r.ref === target.ref)
    if (!found) {
      throw new Error(`Not in cache: ${repo}`)
    }

    if (!skipConfirm) {
      const ok = await confirm(`Remove ${label} (worktree)?`)
      if (!ok) return
    }

    await removeCachedRepo(cacheDir, target)
    console.log(`Removed ${label}`)
    return
  }

  // Remove main clone + all its worktrees
  const cached = await listCachedRepos(cacheDir)
  const main = cached.find(r => r.host === target.host && r.org === target.org && r.repo === target.repo && !r.ref)
  if (!main) {
    throw new Error(`Not in cache: ${repo}`)
  }

  const worktrees = cached.filter(r => r.host === target.host && r.org === target.org && r.repo === target.repo && r.ref)

  if (worktrees.length > 0) {
    if (!skipConfirm) {
      console.log(`This will also remove ${worktrees.length} worktree${worktrees.length === 1 ? '' : 's'}:`)
      for (const wt of worktrees) console.log(`  ${formatCachedRepo(wt)}`)
      const ok = await confirm(`Remove ${label} and all worktrees?`)
      if (!ok) return
    }

    for (const wt of worktrees) {
      await removeCachedRepo(cacheDir, { source: 'git', host: wt.host, org: wt.org, repo: wt.repo, ref: wt.ref })
    }
  } else if (!skipConfirm) {
    const ok = await confirm(`Remove ${label}?`)
    if (!ok) return
  }

  await removeCachedRepo(cacheDir, target)
  const count = 1 + worktrees.length
  console.log(`Removed ${label}${count > 1 ? ` (${count} entries)` : ''}`)
}
