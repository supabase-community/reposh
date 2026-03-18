export interface RepoTarget {
  host: string
  org: string
  repo: string
  ref?: string
}

export interface AllowlistEntry {
  host: string
  org: string
  repos?: string[]
}

export interface RepoCacheConfig {
  cacheDir?: string
  cacheTtl?: number
  allowlist?: AllowlistEntry[]
}

export interface CachedRepo {
  host: string
  org: string
  repo: string
  ref?: string
  path: string
  sizeBytes: number
}

export interface RepoCache {
  ensureRepo(target: string | RepoTarget, opts?: { onProgress?: (msg: string) => void; force?: boolean }): Promise<string>
  listRepos(): Promise<CachedRepo[]>
  removeRepo(target: string | RepoTarget): Promise<void>
}
