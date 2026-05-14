import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/

export interface ResolutionRecord {
  host: string
  org: string
  repo: string
  ref: string
  resolvedAt?: number
}

export interface ReadOptions {
  /** Maximum age in ms. Only applies to non-semver (dist-tag) entries. Pinned semver entries skip this check. */
  maxAgeMs?: number
}

function isPinned(version: string): boolean {
  return SEMVER_RE.test(version)
}

function pathFor(rootDir: string, name: string, version: string): string {
  // Path segments for the package name. Scoped: ['@scope', 'pkg']; unscoped: ['pkg'].
  const parts = name.startsWith('@') ? name.split('/') : [name]
  return join(rootDir, 'npm', ...parts, `${version}.json`)
}

/**
 * Read a cached package resolution from disk.
 *
 * Pinned semver entries (filename matches semver) are returned regardless of age.
 * Dist-tag entries are TTL-bounded by `opts.maxAgeMs` (default: Infinity).
 *
 * Returns `undefined` if the file does not exist, cannot be parsed, or is stale.
 */
export async function readResolution(
  rootDir: string,
  name: string,
  version: string,
  opts: ReadOptions = {},
): Promise<ResolutionRecord | undefined> {
  const file = pathFor(rootDir, name, version)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  let parsed: ResolutionRecord
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (isPinned(version)) return parsed
  const maxAgeMs = opts.maxAgeMs ?? Infinity
  const resolvedAt = parsed.resolvedAt ?? 0
  if (Date.now() - resolvedAt > maxAgeMs) return undefined
  return parsed
}

/**
 * Write a package resolution to disk, stamped with the current time.
 * Creates parent directories as needed.
 */
export async function writeResolution(
  rootDir: string,
  name: string,
  version: string,
  data: Omit<ResolutionRecord, 'resolvedAt'>,
): Promise<void> {
  const file = pathFor(rootDir, name, version)
  await mkdir(dirname(file), { recursive: true })
  const record: ResolutionRecord = { ...data, resolvedAt: Date.now() }
  await writeFile(file, JSON.stringify(record), 'utf8')
}
