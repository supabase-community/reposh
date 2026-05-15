import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { NpmVersionManifest } from './registry.js'

export interface InstalledPackage {
  version: string
  repository?: NpmVersionManifest['repository']
}

/**
 * Find the version + repository field of a locally installed npm package,
 * using node's standard module resolution from the given directory.
 *
 * Returns undefined if the package isn't installed in the resolution chain,
 * or if any read/parse error occurs. Never throws.
 */
export async function findInstalledPackage(
  cwd: string,
  name: string,
): Promise<InstalledPackage | undefined> {
  try {
    // Anchor require resolution at cwd. The path passed here only needs a
    // valid dirname; the file itself doesn't need to exist.
    const req = createRequire(resolve(cwd, 'noop.js'))
    const pkgPath = req.resolve(`${name}/package.json`)
    const raw = await readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(raw) as { version?: string; repository?: NpmVersionManifest['repository'] }
    if (!pkg.version) return undefined
    return { version: pkg.version, repository: pkg.repository }
  } catch {
    return undefined
  }
}
