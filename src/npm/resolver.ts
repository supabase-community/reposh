import type { NpmTarget, GitTarget } from '../types.js'
import { CACHE_DIR, CACHE_TTL, RESOLUTIONS_DIR } from '../constants.js'
import {
  fetchVersionManifest,
  fetchPackumentDistTag,
  fetchAttestations,
  type NpmVersionManifest,
} from './registry.js'
import { parseAttestationBundle } from './provenance.js'
import { parseRepositoryField } from './repo-url.js'
import { tagCandidates } from './tag-candidates.js'
import { tryFetchAnyRef } from '../repo-cache.js'
import { formatTarget } from '../parse-target.js'
import { readResolution, writeResolution, type ResolutionRecord } from './resolutions-cache.js'
import { findInstalledPackage, type InstalledPackage } from './project-version.js'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/

export interface ResolveNpmOptions {
  onProgress?: (msg: string) => void
  force?: boolean
  /**
   * Project directory used for local-first version resolution. When set and
   * the target version is omitted, attempts to read the locally installed
   * package's version+repository field (like `npx` does) before falling back
   * to the registry's `latest` dist-tag. Leave undefined to disable local
   * resolution (e.g. SSH server contexts where there is no meaningful cwd).
   */
  cwd?: string
  /**
   * Override the on-disk resolutions cache directory. Defaults to
   * {@link RESOLUTIONS_DIR}. Primarily for tests.
   */
  resolutionsDir?: string
}

/**
 * Resolve an {@link NpmTarget} to a concrete {@link GitTarget} by, in order:
 * 1. Resolving the version (local install if version omitted and `cwd` set;
 *    dist-tag -> exact version if needed; otherwise pinned semver).
 * 2. Consulting the on-disk resolutions cache (unless `force`).
 * 3. Preferring npm provenance attestations to pin the source SHA.
 * 4. Falling back to the package.json `repository` field plus a tag-name guess.
 *
 * Successful resolutions are written back to the cache. Pinned semver entries
 * are immutable; dist-tag entries are TTL-bounded ({@link CACHE_TTL}).
 *
 * If the registry is unreachable during a fresh resolution and a stale cache
 * entry exists for this key, the stale entry is served with a warning rather
 * than erroring. Mirrors the git layer's stale-on-failure behavior.
 */
export async function resolveNpm(target: NpmTarget, opts: ResolveNpmOptions = {}): Promise<GitTarget> {
  const onProgress = opts.onProgress ?? (() => {})
  const resolutionsDir = opts.resolutionsDir ?? RESOLUTIONS_DIR
  const spec = target.version ? `${target.name}@${target.version}` : target.name

  onProgress(`Resolving npm:${spec}...\n`)

  // 1. Local-first resolution (no network). When the version is omitted and
  //    we have a project cwd, try to find a locally installed copy and use
  //    its version + repository field. Survives a registry outage.
  let localInfo: InstalledPackage | undefined
  if (target.version === undefined && opts.cwd) {
    localInfo = await findInstalledPackage(opts.cwd, target.name)
    if (localInfo) {
      onProgress(`  using locally installed ${target.name}@${localInfo.version}\n`)
    }
  }

  // 2. Cache key derivation. Pinned (exact semver, including local-install hits)
  //    use the version; dist-tag / omitted-without-local use the tag name (or
  //    'latest'). We must derive this without hitting the network so that the
  //    stale-cache fallback (step 5) has something to look up if the registry
  //    is unreachable.
  const explicit = target.version
  let cacheKey: string
  if (localInfo) {
    cacheKey = localInfo.version
  } else if (explicit !== undefined && SEMVER_RE.test(explicit)) {
    cacheKey = explicit
  } else {
    cacheKey = explicit ?? 'latest'
  }

  // 3. Read-through cache (unless force).
  if (!opts.force) {
    const cached = await readResolution(resolutionsDir, target.name, cacheKey, { maxAgeMs: CACHE_TTL })
    if (cached) {
      const resolved = cachedToGitTarget(cached)
      onProgress(`  cached resolution -> ${formatTarget(resolved, { full: true })}\n`)
      return resolved
    }
  }

  // 4. Resolve fresh. On any registry/network failure, fall back to a stale
  //    cache entry (if any) rather than erroring out. Mirrors the git layer's
  //    refreshRepo "use stale on failure" pattern.
  try {
    // Determine the exact version to resolve. If we found a local install,
    // use that. Otherwise hit the registry (semver passes through; dist-tags
    // resolve to a concrete version).
    const exactVersion = localInfo
      ? localInfo.version
      : await resolveExactVersionFromRegistry(target)

    const provenance = await tryProvenance(target.name, exactVersion, onProgress)
    if (provenance) {
      onProgress(`  -> ${formatTarget(provenance, { full: true })} (verified via npm provenance)\n`)
      await writeResolution(resolutionsDir, target.name, cacheKey, {
        host: provenance.host, org: provenance.org, repo: provenance.repo, ref: provenance.ref,
      })
      return provenance
    }

    // 5. Fallback: package.json repository + tag match.
    const fallback = await resolveFallback(target.name, exactVersion, onProgress, localInfo)
    await writeResolution(resolutionsDir, target.name, cacheKey, {
      host: fallback.host, org: fallback.org, repo: fallback.repo, ref: fallback.ref,
    })
    return fallback
  } catch (err) {
    const stale = await readResolution(resolutionsDir, target.name, cacheKey, { maxAgeMs: Infinity })
    if (stale) {
      const errMsg = err instanceof Error ? err.message : String(err)
      onProgress(`  resolution refresh failed, using stale cache: ${errMsg}\n`)
      return cachedToGitTarget(stale)
    }
    throw err
  }
}

async function resolveExactVersionFromRegistry(target: NpmTarget): Promise<string> {
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
  localInfo?: InstalledPackage,
): Promise<GitTarget> {
  // Prefer the locally installed package's repository field when available,
  // saving a registry round-trip. Falls back to fetching the version manifest.
  let repoField: NpmVersionManifest['repository']
  if (localInfo) {
    repoField = localInfo.repository
  } else {
    const manifest = await fetchVersionManifest(name, version)
    repoField = manifest.repository
  }

  const loc = parseRepositoryField(repoField)

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

  const resolved: GitTarget = {
    source: 'git',
    host: loc.host,
    org: loc.org,
    repo: loc.repo,
    ref: matched,
  }
  onProgress(`  -> ${formatTarget(resolved, { full: true })} (via package.json#repository)\n`)
  return resolved
}

function cachedToGitTarget(c: ResolutionRecord): GitTarget {
  return { source: 'git', host: c.host, org: c.org, repo: c.repo, ref: c.ref }
}

