import { formatRepoTarget } from './parse-target.js'
import type { RepoTarget, AllowlistEntry } from './types.js'

export function checkAllowlist(target: RepoTarget, allowlist?: AllowlistEntry[]): void {
  if (!allowlist || allowlist.length === 0) return

  const allowed = allowlist.some(entry => {
    if (target.host !== entry.host) return false
    if (target.org !== entry.org) return false
    if (entry.repos && !entry.repos.includes(target.repo)) return false
    return true
  })

  if (!allowed) {
    throw new Error(`Access denied: ${formatRepoTarget(target)} is not in the allowlist`)
  }
}
