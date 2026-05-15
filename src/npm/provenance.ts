export interface ProvenanceResult {
  host: string
  org: string
  repo: string
  sha: string
}

/**
 * Parse an npm attestations payload to extract the source repo and commit SHA
 * from the SLSA provenance attestation.
 *
 * Returns undefined if no provenance attestation is found or it can't be parsed.
 */
export function parseAttestationBundle(payload: unknown): ProvenanceResult | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const attestations = (payload as { attestations?: unknown[] }).attestations
  if (!Array.isArray(attestations)) return undefined

  for (const a of attestations) {
    if (!a || typeof a !== 'object') continue
    const predicateType = (a as { predicateType?: string }).predicateType ?? ''
    if (!predicateType.includes('slsa.dev/provenance')) continue

    const bundle = (a as { bundle?: unknown }).bundle
    const statement = decodeStatement(bundle)
    if (!statement) continue

    const sourceInfo = extractSource(statement)
    if (sourceInfo) return sourceInfo
  }

  return undefined
}

function decodeStatement(bundle: unknown): unknown {
  if (!bundle || typeof bundle !== 'object') return undefined
  const env = (bundle as { dsseEnvelope?: { payload?: string } }).dsseEnvelope
  if (!env?.payload) return undefined
  try {
    const json = Buffer.from(env.payload, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

/** Strip `git+` prefix and any `@<ref>` suffix from a repo URI for matching. */
function normalizeRepoUri(uri: string): string {
  return uri.replace(/^git\+/, '').replace(/@[^/]*$/, '')
}

function extractSource(statement: unknown): ProvenanceResult | undefined {
  if (!statement || typeof statement !== 'object') return undefined
  const predicate = (statement as { predicate?: unknown }).predicate
  if (!predicate || typeof predicate !== 'object') return undefined

  // SLSA v1: predicate.buildDefinition.externalParameters.workflow.repository (source repo URL)
  const v1Workflow = (predicate as {
    buildDefinition?: { externalParameters?: { workflow?: { repository?: string } } }
  }).buildDefinition?.externalParameters?.workflow

  if (v1Workflow?.repository) {
    const loc = parseRepoUrl(v1Workflow.repository)
    if (!loc) return undefined

    const deps = (predicate as {
      buildDefinition?: { resolvedDependencies?: Array<{ uri?: string; digest?: Record<string, string> }> }
    }).buildDefinition?.resolvedDependencies ?? []

    const normalizedRepo = normalizeRepoUri(v1Workflow.repository)
    for (const d of deps) {
      if (d.uri && normalizeRepoUri(d.uri) === normalizedRepo && d.digest?.gitCommit) {
        return { ...loc, sha: d.digest.gitCommit }
      }
    }
    // Fallback: try to find any git-commit-shaped digest under resolvedDependencies
    for (const d of deps) {
      if (d.digest?.gitCommit) return { ...loc, sha: d.digest.gitCommit }
    }
  }

  // SLSA v0.2: predicate.invocation.configSource.{uri, digest.sha1}
  const v02 = (predicate as {
    invocation?: { configSource?: { uri?: string; digest?: { sha1?: string } } }
  }).invocation?.configSource

  if (v02?.uri && v02.digest?.sha1) {
    const loc = parseRepoUrl(v02.uri)
    if (loc) return { ...loc, sha: v02.digest.sha1 }
  }

  return undefined
}

function parseRepoUrl(url: string): { host: string; org: string; repo: string } | undefined {
  try {
    // Some SLSA URIs use 'git+https://' or include '@<ref>' suffix.
    const cleaned = normalizeRepoUri(url)
    const u = new URL(cleaned)
    const segments = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    if (segments.length < 2) return undefined
    return { host: u.hostname, org: segments[0], repo: segments[1] }
  } catch {
    return undefined
  }
}
