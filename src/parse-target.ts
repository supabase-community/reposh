const SAFE_COMPONENT = /^[a-zA-Z0-9._-]+$/

export interface RepoTarget {
  host: string
  org: string
  repo: string
}

// Parses SSH username into a repo target.
// "org/repo"          → { host: "github.com", org, repo }
// "github.com/org/repo" → { host, org, repo }
export function parseRepoTarget(username: string): RepoTarget | null {
  if (!username) return null

  const parts = username.split('/')

  if (parts.length === 2) {
    const [org, repo] = parts
    if (!SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return null
    return { host: 'github.com', org, repo }
  }

  if (parts.length === 3 && parts[0].includes('.')) {
    const [host, org, repo] = parts
    if (!SAFE_COMPONENT.test(host) || !SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return null
    return { host, org, repo }
  }

  return null
}
