import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepoCache } from './repo-cache.js'
import type { GitTarget } from './types.js'

// A stable, known-reachable commit on github.com/octocat/Hello-World.
// Hello-World is GitHub's canonical example repo - tiny and unchanging,
// so it avoids Windows MAX_PATH problems that big monorepos (like facebook/react) hit.
const HELLO_WORLD_SHA = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d'

describe('ensureRepo with commit SHA', () => {
  let cacheDir: string

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'reposh-sha-integration-'))
  })

  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('fetches a repo by full 40-char commit SHA', async () => {
    const cache = createRepoCache({ cacheDir })
    const target: GitTarget = {
      source: 'git',
      host: 'github.com',
      org: 'octocat',
      repo: 'Hello-World',
      ref: HELLO_WORLD_SHA,
    }

    const path = await cache.ensureRepo(target)

    expect(path).toContain(HELLO_WORLD_SHA)
  })
})
