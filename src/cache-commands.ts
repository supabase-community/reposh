import { readdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_DIR } from './paths.js'
import { parseRepoTarget } from './parse-target.js'

interface CachedRepo {
  host: string
  org: string
  repo: string
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

      const repoNames = await readdir(orgDir)
      for (const repo of repoNames) {
        const repoPath = join(orgDir, repo)
        if (!(await stat(repoPath).catch(() => null))?.isDirectory()) continue

        const sizeBytes = await dirSize(repoPath)
        repos.push({ host, org, repo, path: repoPath, sizeBytes })
      }
    }
  }

  return repos
}

export async function cacheLs(): Promise<void> {
  const repos = await findCachedRepos()
  if (repos.length === 0) {
    console.log('No cached repos.')
    return
  }
  for (const r of repos) {
    const label = r.host === 'github.com' ? `${r.org}/${r.repo}` : `${r.host}/${r.org}/${r.repo}`
    console.log(`${label}  ${formatSize(r.sizeBytes)}`)
  }
  const total = repos.reduce((sum, r) => sum + r.sizeBytes, 0)
  console.log(`\n${repos.length} repo${repos.length === 1 ? '' : 's'}, ${formatSize(total)} total`)
}

export async function cacheRm(repo?: string, all?: boolean): Promise<void> {
  if (!repo && !all) {
    throw new Error('Specify a repo to remove, or use --all to clear the entire cache')
  }

  if (all) {
    const repos = await findCachedRepos()
    if (repos.length === 0) {
      console.log('Cache is already empty.')
      return
    }
    await rm(CACHE_DIR, { recursive: true, force: true })
    console.log(`Removed ${repos.length} repo${repos.length === 1 ? '' : 's'} from cache.`)
    return
  }

  const target = parseRepoTarget(repo!)
  if (!target) {
    throw new Error(`Invalid repo: ${repo}`)
  }

  const dir = join(CACHE_DIR, target.host, target.org, target.repo)
  const exists = await stat(dir).catch(() => null)
  if (!exists) {
    throw new Error(`Not in cache: ${repo}`)
  }

  await rm(dir, { recursive: true, force: true })
  const label = target.host === 'github.com' ? `${target.org}/${target.repo}` : `${target.host}/${target.org}/${target.repo}`
  console.log(`Removed ${label}`)
}
