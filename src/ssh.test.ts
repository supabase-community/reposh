import { describe, it, expect, vi } from 'vitest'
import { statSync } from 'node:fs'

const { testKeyPath } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const tmpDir = mkdtempSync(join(tmpdir(), 'reposh-ssh-test-'))
  return { testKeyPath: join(tmpDir, 'host_key') }
})

vi.mock('./paths.js', () => ({
  HOST_KEY_PATH: testKeyPath,
}))

// Avoid pulling in repo-cache/run-command deps
vi.mock('./repo-cache.js', () => ({ ensureRepo: vi.fn() }))
vi.mock('./run-command.js', () => ({
  makeBash: vi.fn(),
  makePrefix: vi.fn(),
  makeProgressWriter: vi.fn(),
  execCommand: vi.fn(),
}))

import { loadOrCreateHostKey } from './ssh.js'

describe('loadOrCreateHostKey', () => {
  it('generates a new key when none exists', async () => {
    const log = vi.fn()
    const key = await loadOrCreateHostKey(log)

    expect(key).toBeInstanceOf(Buffer)
    expect(key.toString()).toContain('BEGIN RSA PRIVATE KEY')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Generated host key'))
  })

  it('loads existing key on second call', async () => {
    const log = vi.fn()
    const key = await loadOrCreateHostKey(log)

    expect(key.toString()).toContain('BEGIN RSA PRIVATE KEY')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Loaded host key'))
  })

  it.skipIf(process.platform === 'win32')('sets restrictive file permissions on generated key', () => {
    const mode = statSync(testKeyPath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('returns the same key on both calls', async () => {
    const key1 = await loadOrCreateHostKey(() => {})
    const key2 = await loadOrCreateHostKey(() => {})
    expect(key1.toString()).toBe(key2.toString())
  })
})
