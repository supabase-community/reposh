import type { NpmVersionManifest } from './registry.js'

export interface RepoLocation {
  host: string
  org: string
  repo: string
}

/**
 * Normalize the various forms of the `package.json#repository` field
 * into a {host, org, repo} triple. Returns undefined if the field is
 * missing, empty, or in an unsupported form.
 */
export function parseRepositoryField(field: NpmVersionManifest['repository']): RepoLocation | undefined {
  const url = typeof field === 'string' ? field : field?.url
  if (!url) return undefined

  // 1. Shorthand: github:foo/bar, gitlab:foo/bar, bitbucket:foo/bar
  const shorthand = url.match(/^(github|gitlab|bitbucket):([^/]+)\/(.+?)(?:\.git)?$/)
  if (shorthand) {
    const [, host, org, repo] = shorthand
    const fullHost = host === 'github' ? 'github.com' : host === 'gitlab' ? 'gitlab.com' : 'bitbucket.org'
    return { host: fullHost, org, repo }
  }

  // 2. SSH-style: git@host:org/repo(.git)  - distinguished from URLs by absence of "://"
  if (!url.includes('://')) {
    const ssh = url.match(/^(?:git@)?([^:]+):([^/]+)\/(.+?)(?:\.git)?$/)
    if (ssh) {
      const [, host, org, repo] = ssh
      return { host, org, repo }
    }
    return undefined
  }

  // 3. Standard URL (with optional git+ prefix). Supported protocols: http(s), git.
  const cleaned = url.replace(/^git\+/, '')
  try {
    const u = new URL(cleaned)
    if (!['http:', 'https:', 'git:'].includes(u.protocol)) return undefined
    const segments = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    if (segments.length < 2 || !segments[0] || !segments[1]) return undefined
    return { host: u.hostname, org: segments[0], repo: segments[1] }
  } catch {
    return undefined
  }
}
