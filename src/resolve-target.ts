import type { Target, GitTarget } from './types.js'
import { resolveNpm } from './npm/resolver.js'

export interface ResolveOptions {
  onProgress?: (msg: string) => void
  force?: boolean
  /**
   * Project directory used by the npm resolver for local-first version
   * resolution. See {@link import('./npm/resolver.js').ResolveNpmOptions}.
   * Ignored for git targets.
   */
  cwd?: string
  /**
   * Override the npm resolutions cache directory. Primarily for tests.
   * Ignored for git targets.
   */
  resolutionsDir?: string
}

/**
 * Resolve a {@link Target} to a concrete {@link GitTarget}.
 *
 * Git targets pass through unchanged. Npm targets are delegated to
 * {@link resolveNpm}, which uses provenance attestations when available
 * and falls back to the `package.json#repository` field plus tag matching.
 *
 * The `force` option is reserved for later phases when a disk cache
 * is added. It is a no-op at this layer for git targets.
 */
export async function resolveTarget(target: Target, opts: ResolveOptions = {}): Promise<GitTarget> {
  if (target.source === 'git') return target
  if (target.source === 'npm') return resolveNpm(target, opts)
  const _exhaustive: never = target
  throw new Error(`Unknown target source: ${JSON.stringify(_exhaustive)}`)
}
