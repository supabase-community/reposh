import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepoCache } from './repo-cache.js'
import type { GitTarget } from './types.js'

// SHA of facebook/react v18.2.0 tag - a stable, known-reachable commit on github.com/facebook/react.
const REACT_V18_2_0_SHA = '8cab1b4d64ca7f52e5e1b45c4e6a6a99cc1ed591'

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
      org: 'facebook',
      repo: 'react',
      ref: REACT_V18_2_0_SHA,
    }

    const path = await cache.ensureRepo(target)

    expect(path).toContain(REACT_V18_2_0_SHA)
  })
})
