const SAFE_COMPONENT = /^[a-zA-Z0-9._-]+$/
// Valid hostname: at least one dot, starts and ends with alnum (e.g. "github.com")
const VALID_HOST = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})$/
// Valid git ref: alphanumeric, dots, hyphens, underscores, forward slashes
const SAFE_REF = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$|^[a-zA-Z0-9]$/

export interface RepoTarget {
  host: string
  org: string
  repo: string
  ref?: string
}

function isValidRef(ref: string): boolean {
  if (!SAFE_REF.test(ref)) return false
  if (ref.includes('..')) return false
  if (ref.includes('//')) return false
  if (ref.endsWith('.lock')) return false
  if (ref.endsWith('/')) return false
  return true
}

export function repoLabel(target: RepoTarget): string {
  const base = target.host === 'github.com'
    ? `${target.org}/${target.repo}`
    : `${target.host}/${target.org}/${target.repo}`
  return target.ref ? `${base}:${target.ref}` : base
}

// Parses SSH username or CLI arg into a repo target.
// "org/repo"              → { host: "github.com", org, repo }
// "org/repo:ref"          → { host: "github.com", org, repo, ref }
// "gitlab.com/org/repo"   → { host, org, repo }
// "gitlab.com/org/repo:ref" → { host, org, repo, ref }
// Repos are always cloned over HTTPS.
export function parseRepoTarget(username: string): RepoTarget | undefined {
  if (!username) return undefined

  // Split off optional :ref suffix
  let ref: string | undefined
  const colonIdx = username.indexOf(':')
  let target = username
  if (colonIdx !== -1) {
    ref = username.slice(colonIdx + 1)
    target = username.slice(0, colonIdx)
    if (!ref || !isValidRef(ref)) return undefined
  }

  const parts = target.split('/')

  if (parts.length === 2) {
    const [org, repo] = parts
    if (!SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return undefined
    return { host: 'github.com', org, repo, ...(ref && { ref }) }
  }

  if (parts.length === 3) {
    const [host, org, repo] = parts
    if (!VALID_HOST.test(host) || !SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return undefined
    return { host, org, repo, ...(ref && { ref }) }
  }

  return undefined
}
