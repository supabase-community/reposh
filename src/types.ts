export interface GitTarget {
  source: 'git'
  host: string
  org: string
  repo: string
  ref?: string
}

export interface NpmTarget {
  source: 'npm'
  name: string
  version?: string
}

export type Target = GitTarget | NpmTarget

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
  ensureRepo(target: string | Target, opts?: { onProgress?: (msg: string) => void; force?: boolean }): Promise<string>
  listRepos(): Promise<CachedRepo[]>
  removeRepo(target: string | GitTarget): Promise<void>
}
