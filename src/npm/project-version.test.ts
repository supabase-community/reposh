import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findInstalledPackage } from './project-version.js'

describe('findInstalledPackage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reposh-project-version-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writeFakePkg(pkgName: string, version: string, repository?: unknown) {
    const pkgDir = join(dir, 'node_modules', pkgName)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkgName, version, ...(repository ? { repository } : {}) }),
    )
  }

  it('returns version and repository for an installed unscoped package', async () => {
    await writeFakePkg('lodash', '4.17.20', 'https://github.com/lodash/lodash.git')
    const result = await findInstalledPackage(dir, 'lodash')
    expect(result).toEqual({
      version: '4.17.20',
      repository: 'https://github.com/lodash/lodash.git',
    })
  })

  it('returns version+repository for an installed scoped package', async () => {
    await writeFakePkg('@types/node', '20.0.0', { type: 'git', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped.git' })
    const result = await findInstalledPackage(dir, '@types/node')
    expect(result?.version).toBe('20.0.0')
    expect(result?.repository).toMatchObject({ url: expect.stringContaining('DefinitelyTyped') })
  })

  it('returns undefined for a not-installed package', async () => {
    expect(await findInstalledPackage(dir, 'lodash')).toBeUndefined()
  })

  it('returns undefined when version field is missing', async () => {
    const pkgDir = join(dir, 'node_modules', 'broken')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'broken' }))
    expect(await findInstalledPackage(dir, 'broken')).toBeUndefined()
  })

  it('returns undefined for malformed package.json', async () => {
    const pkgDir = join(dir, 'node_modules', 'malformed')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), 'not json {{{')
    expect(await findInstalledPackage(dir, 'malformed')).toBeUndefined()
  })

  it('walks up to find node_modules from a nested cwd', async () => {
    await writeFakePkg('lodash', '4.17.20')
    const nested = join(dir, 'src', 'deeply', 'nested')
    await mkdir(nested, { recursive: true })
    const result = await findInstalledPackage(nested, 'lodash')
    expect(result?.version).toBe('4.17.20')
  })
})
