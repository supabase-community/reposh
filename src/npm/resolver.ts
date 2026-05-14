import type { NpmTarget, GitTarget } from '../types.js'
import { CACHE_DIR, CACHE_TTL, RESOLUTIONS_DIR } from '../constants.js'
import {
  fetchVersionManifest,
  fetchPackumentDistTag,
  fetchAttestations,
} from './registry.js'
import { parseAttestationBundle } from './provenance.js'
import { parseRepositoryField } from './repo-url.js'
import { tagCandidates } from './tag-candidates.js'
import { tryFetchAnyRef } from '../repo-cache.js'
import { readResolution, writeResolution } from './resolutions-cache.js'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/

export interface ResolveNpmOptions {
  onProgress?: (msg: string) => void
  force?: boolean
}

/**
 * Resolve an {@link NpmTarget} to a concrete {@link GitTarget} by, in order:
 * 1. Resolving the version (dist-tag -> exact version if needed).
 * 2. Consulting the on-disk resolutions cache (unless `force`).
 * 3. Preferring npm provenance attestations to pin the source SHA.
 * 4. Falling back to the package.json `repository` field plus a tag-name guess.
 *
 * Successful resolutions are written back to the cache. Pinned semver entries
 * are immutable; dist-tag entries are TTL-bounded ({@link CACHE_TTL}).
 */
export async function resolveNpm(target: NpmTarget, opts: ResolveNpmOptions = {}): Promise<GitTarget> {
  const onProgress = opts.onProgress ?? (() => {})
  const spec = target.version ? `${target.name}@${target.version}` : target.name

  onProgress(`Resolving npm:${spec}...\n`)

  // 1. Resolve to exact published version.
  const exactVersion = await resolveExactVersion(target)

  // 2. Cache key: pinned uses exact version; dist-tag/omitted uses the tag name (or 'latest').
  const cacheKey = SEMVER_RE.test(target.version ?? '') ? exactVersion : (target.version ?? 'latest')

  // 3. Read-through cache (unless force).
  if (!opts.force) {
    const cached = await readResolution(RESOLUTIONS_DIR, target.name, cacheKey, { maxAgeMs: CACHE_TTL })
    if (cached) {
      onProgress(`  cached resolution -> ${cached.host}/${cached.org}/${cached.repo}@${shortSha(cached.ref)}\n`)
      return {
        source: 'git',
        host: cached.host,
        org: cached.org,
        repo: cached.repo,
        ref: cached.ref,
      }
    }
  }

  // 4. Try provenance.
  const provenance = await tryProvenance(target.name, exactVersion, onProgress)
  if (provenance) {
    onProgress(`  -> ${formatGit(provenance)}@${shortSha(provenance.ref)} (verified via npm provenance)\n`)
    await writeResolution(RESOLUTIONS_DIR, target.name, cacheKey, {
      host: provenance.host, org: provenance.org, repo: provenance.repo, ref: provenance.ref,
    })
    return provenance
  }

  // 5. Fallback: package.json repository + tag match.
  const fallback = await resolveFallback(target.name, exactVersion, onProgress)
  await writeResolution(RESOLUTIONS_DIR, target.name, cacheKey, {
    host: fallback.host, org: fallback.org, repo: fallback.repo, ref: fallback.ref,
  })
  return fallback
}

async function resolveExactVersion(target: NpmTarget): Promise<string> {
  const v = target.version ?? 'latest'
  if (SEMVER_RE.test(v)) return v
  return fetchPackumentDistTag(target.name, v)
}

async function tryProvenance(
  name: string,
  version: string,
  onProgress: (msg: string) => void,
): Promise<GitTarget | undefined> {
  let bundle: unknown
  try {
    bundle = await fetchAttestations(name, version)
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_ATTESTATIONS') {
      onProgress(`  no provenance attestation\n`)
      return undefined
    }
    throw err
  }

  const parsed = parseAttestationBundle(bundle)
  if (!parsed) {
    onProgress(`  provenance attestation present but unparseable; falling back\n`)
    return undefined
  }

  return {
    source: 'git',
    host: parsed.host,
    org: parsed.org,
    repo: parsed.repo,
    ref: parsed.sha,
  }
}

async function resolveFallback(
  name: string,
  version: string,
  onProgress: (msg: string) => void,
): Promise<GitTarget> {
  const manifest = await fetchVersionManifest(name, version)
  const loc = parseRepositoryField(manifest.repository)

  if (!loc) {
    throw new Error(
      `Failed to resolve npm:${name}@${version}\n` +
      `  no provenance attestation\n` +
      `  no usable repository field in package.json`,
    )
  }

  const repoLabel = loc.host === 'github.com'
    ? `${loc.org}/${loc.repo}`
    : `${loc.host}/${loc.org}/${loc.repo}`

  onProgress(`  package.json#repository -> ${loc.host}/${loc.org}/${loc.repo}\n`)

  const candidates = tagCandidates(name, version)
  let matched: string
  try {
    matched = await tryFetchAnyRef(CACHE_DIR, loc, candidates, onProgress)
  } catch {
    const tried = candidates.join(', ')
    throw new Error(
      `Failed to resolve npm:${name}@${version}\n` +
      `  no provenance attestation\n` +
      `  package.json#repository -> ${loc.host}/${loc.org}/${loc.repo}\n` +
      `  no matching tag (tried: ${tried})\n\n` +
      `Try directly: reposh ${repoLabel}@<tag>`,
    )
  }

  onProgress(`  -> ${loc.host}/${loc.org}/${loc.repo}@${matched} (via package.json#repository)\n`)

  return {
    source: 'git',
    host: loc.host,
    org: loc.org,
    repo: loc.repo,
    ref: matched,
  }
}

function formatGit(t: GitTarget): string {
  return t.host === 'github.com' ? `${t.org}/${t.repo}` : `${t.host}/${t.org}/${t.repo}`
}

function shortSha(s: string): string {
  return s.length === 40 ? s.slice(0, 7) : s
}
