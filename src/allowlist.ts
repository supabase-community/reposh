import type { GitTarget, AllowlistEntry } from './types.js'

export function checkAllowlist(target: GitTarget, allowlist?: AllowlistEntry[]): void {
  if (!allowlist || allowlist.length === 0) return

  const allowed = allowlist.some(entry => {
    if (target.host !== entry.host) return false
    if (target.org !== entry.org) return false
    if (entry.repos && !entry.repos.includes(target.repo)) return false
    return true
  })

  if (!allowed) {
    const label = target.host === 'github.com'
      ? `${target.org}/${target.repo}`
      : `${target.host}/${target.org}/${target.repo}`
    throw new Error(`Access denied: ${label} is not in the allowlist`)
  }
}
