import type { Target, GitTarget, NpmTarget } from './types.js'

const SAFE_COMPONENT = /^[a-zA-Z0-9._-]+$/
// Valid hostname: at least one dot, starts and ends with alnum (e.g. "github.com")
const VALID_HOST = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})$/
// Valid git ref: alphanumeric, dots, hyphens, underscores, forward slashes
const SAFE_REF = /^[a-zA-Z0-9@][a-zA-Z0-9._\/@+-]*$|^[a-zA-Z0-9]$/
// npm name segment: lowercase alnum + ._-, must start with alnum
const NPM_NAME_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/

function isValidRef(ref: string): boolean {
  if (!SAFE_REF.test(ref)) return false
  if (ref.includes('..')) return false
  if (ref.includes('//')) return false
  if (ref.endsWith('.lock')) return false
  if (ref.endsWith('/')) return false
  return true
}

/**
 * Parse a target string into a {@link Target}.
 *
 * Grammar:
 *   [<source>:]<spec>
 *
 * Known sources: `git`, `npm`. Default (no prefix) is git.
 *
 * Git: `[host/]org/repo[@ref]` (canonical) or `[host/]org/repo[:ref]` (legacy).
 * When both `@` and `:` are present, the earlier one wins.
 *
 * Npm: `name[@version]` or `@scope/name[@version]`.
 */
export function parseTarget(input: string): Target | undefined {
  if (!input) return undefined
  if (input.startsWith('git:')) return parseGitTarget(input.slice(4))
  if (input.startsWith('npm:')) return parseNpmTarget(input.slice(4))

  // Reject unknown source-like prefixes (a leading word followed by `:` not preceded by `/`).
  const colonIdx = input.indexOf(':')
  const slashIdx = input.indexOf('/')
  if (colonIdx !== -1 && (slashIdx === -1 || colonIdx < slashIdx)) {
    // Looks like "<unknown-prefix>:..." - but only refuse if the prefix
    // contains no characters that would never appear in an org name. We
    // treat the case where the part before `:` is a simple word as a
    // prefix. But careful: `org/repo:ref` has slashIdx < colonIdx so we
    // don't hit this branch. Only `something:foo` (no slash, or colon
    // before slash) reaches here. Since git targets always have at least
    // one slash before any colon (since org/repo is required), this is
    // an unknown prefix.
    return undefined
  }

  return parseGitTarget(input)
}

function parseGitTarget(input: string): GitTarget | undefined {
  if (!input) return undefined

  let ref: string | undefined
  let target = input

  const atIdx = input.indexOf('@')
  const colonIdx = input.indexOf(':')

  if (atIdx !== -1 && (colonIdx === -1 || atIdx < colonIdx)) {
    ref = input.slice(atIdx + 1)
    target = input.slice(0, atIdx)
  } else if (colonIdx !== -1) {
    ref = input.slice(colonIdx + 1)
    target = input.slice(0, colonIdx)
  }

  if (ref !== undefined) {
    if (!ref || !isValidRef(ref)) return undefined
  }

  const parts = target.split('/')

  if (parts.length === 2) {
    const [org, repo] = parts
    if (!SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return undefined
    return { source: 'git', host: 'github.com', org, repo, ...(ref && { ref }) }
  }

  if (parts.length === 3) {
    const [host, org, repo] = parts
    if (!VALID_HOST.test(host) || !SAFE_COMPONENT.test(org) || !SAFE_COMPONENT.test(repo)) return undefined
    return { source: 'git', host, org, repo, ...(ref && { ref }) }
  }

  return undefined
}

function parseNpmTarget(input: string): NpmTarget | undefined {
  if (!input) return undefined

  let name: string
  let version: string | undefined

  if (input.startsWith('@')) {
    const slashIdx = input.indexOf('/')
    if (slashIdx === -1) return undefined
    // Version separator is the first `@` AFTER the `/`
    const versionAtIdx = input.indexOf('@', slashIdx)
    if (versionAtIdx === -1) {
      name = input
    } else {
      name = input.slice(0, versionAtIdx)
      version = input.slice(versionAtIdx + 1)
    }
    const [scope, pkg] = name.slice(1).split('/')
    if (!scope || !pkg) return undefined
    if (!NPM_NAME_SEGMENT.test(scope) || !NPM_NAME_SEGMENT.test(pkg)) return undefined
  } else {
    const atIdx = input.indexOf('@')
    if (atIdx === -1) {
      name = input
    } else {
      name = input.slice(0, atIdx)
      version = input.slice(atIdx + 1)
    }
    if (!NPM_NAME_SEGMENT.test(name)) return undefined
  }

  if (version !== undefined && !version) return undefined

  return { source: 'npm', name, ...(version && { version }) }
}

/**
 * Format a {@link Target} into its canonical string form.
 *
 * For git targets, `github.com` is elided by default to match the shorthand
 * input syntax. Pass `{ full: true }` to always include the host - useful
 * for logs where the host should be explicit.
 */
export function formatTarget(target: Target, opts?: { full?: boolean }): string {
  if (target.source === 'git') return formatGitTarget(target, opts)
  return formatNpmTarget(target)
}

function formatGitTarget(target: GitTarget, opts?: { full?: boolean }): string {
  const showHost = opts?.full || target.host !== 'github.com'
  const base = showHost
    ? `${target.host}/${target.org}/${target.repo}`
    : `${target.org}/${target.repo}`
  return target.ref ? `${base}@${target.ref}` : base
}

function formatNpmTarget(target: NpmTarget): string {
  return target.version ? `npm:${target.name}@${target.version}` : `npm:${target.name}`
}

/**
 * Resolve a {@link Target} or its string form, throwing on invalid input.
 * Synchronous: does not perform any network resolution.
 */
export function resolveTargetSync(target: string | Target): Target {
  if (typeof target !== 'string') return target
  const parsed = parseTarget(target)
  if (!parsed) throw new Error(`Invalid target: ${target}`)
  return parsed
}
