import type { Target, GitTarget } from './types.js'

export interface ResolveOptions {
  onProgress?: (msg: string) => void
  force?: boolean
}

/**
 * Resolve a {@link Target} to a concrete {@link GitTarget}.
 *
 * Git targets pass through unchanged. Npm targets currently throw a
 * "not yet implemented" error; npm resolution will be wired up in a
 * later phase.
 *
 * The `force` option is reserved for later phases when a disk cache
 * is added. It is a no-op at this layer for git targets.
 */
export async function resolveTarget(target: Target, _opts: ResolveOptions = {}): Promise<GitTarget> {
  if (target.source === 'git') return target
  if (target.source === 'npm') {
    throw new Error('npm target resolution not yet implemented')
  }
  const _exhaustive: never = target
  throw new Error(`Unknown target source: ${JSON.stringify(_exhaustive)}`)
}
