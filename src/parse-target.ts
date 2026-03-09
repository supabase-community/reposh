const SAFE_COMPONENT = /^[a-zA-Z0-9._-]+$/
// Valid hostname: at least one dot, starts and ends with alnum (e.g. "github.com")
const VALID_HOST = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})$/

export interface RepoTarget {
  host: string
  org: string
  repo: string
}

// Parses SSH username into a repo target.
// "org/repo"              → { host: "github.com", org, repo }
// "gitlab.com/org/repo"   → { host, org, repo }
// Repos are always cloned over HTTPS.
export function parseRepoTarget(username: string): RepoTarget | undefined {
  if (!username) return undefined

  const parts = username.split('/')

  if (parts.length === 2) {
    const [org, repo] = parts
    if (!SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return undefined
    return { host: 'github.com', org, repo }
  }

  if (parts.length === 3) {
    const [host, org, repo] = parts
    if (!VALID_HOST.test(host) || !SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return undefined
    return { host, org, repo }
  }

  return undefined
}
