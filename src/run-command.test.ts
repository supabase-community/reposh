import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeBash, makePrefix, makeProgressWriter, execCommand } from './run-command.js'
import type { RepoTarget } from './parse-target.js'

describe('makePrefix', () => {
  it('builds /repos/<host>/<org>/<repo> path', () => {
    const target: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react' }
    expect(makePrefix(target)).toBe('/repos/github.com/facebook/react')
  })

  it('works with custom hosts', () => {
    const target: RepoTarget = { host: 'gitlab.com', org: 'user', repo: 'project' }
    expect(makePrefix(target)).toBe('/repos/gitlab.com/user/project')
  })

  it('includes ref in prefix when specified', () => {
    const target: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0' }
    expect(makePrefix(target)).toBe('/repos/github.com/facebook/react@v18.2.0')
  })

  it('includes ref with slashes in prefix', () => {
    const target: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react', ref: 'feature/hooks' }
    expect(makePrefix(target)).toBe('/repos/github.com/facebook/react@feature/hooks')
  })

  it('omits ref from prefix when not specified', () => {
    const target: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react' }
    expect(makePrefix(target)).toBe('/repos/github.com/facebook/react')
  })
})

describe('makeProgressWriter', () => {
  it('passes messages through when animated', () => {
    const messages: string[] = []
    const writer = makeProgressWriter((msg) => messages.push(msg), true)

    writer('hello')
    writer('world')

    expect(messages).toEqual(['hello', 'world'])
  })

  it('passes plain messages through when not animated', () => {
    const messages: string[] = []
    const writer = makeProgressWriter((msg) => messages.push(msg), false)

    writer('Cloning repo...\n')

    expect(messages).toEqual(['Cloning repo...\n'])
  })

  it('strips ANSI sequences and deduplicates phases when not animated', () => {
    const messages: string[] = []
    const writer = makeProgressWriter((msg) => messages.push(msg), false)

    writer('\r\x1b[KCloning into repo: receiving objects (1%)')
    writer('\r\x1b[KCloning into repo: receiving objects (50%)')
    writer('\r\x1b[KCloning into repo: resolving deltas')

    expect(messages).toEqual([
      'Cloning into repo: receiving objects\n',
      'Cloning into repo: resolving deltas\n',
    ])
  })

  it('ignores unrecognized ANSI messages', () => {
    const messages: string[] = []
    const writer = makeProgressWriter((msg) => messages.push(msg), false)

    writer('\x1b[2Jsome random ansi')

    expect(messages).toEqual([])
  })
})

describe('execCommand', () => {
  it('writes stdout and stderr from bash result', async () => {
    const mockBash = {
      exec: vi.fn().mockResolvedValue({
        stdout: 'hello\n',
        stderr: 'warn\n',
        exitCode: 0,
      }),
    }

    const stdout: string[] = []
    const stderr: string[] = []

    const code = await execCommand(
      mockBash as any,
      'echo hello',
      (s) => stdout.push(s),
      (s) => stderr.push(s),
    )

    expect(code).toBe(0)
    expect(stdout).toEqual(['hello\n'])
    expect(stderr).toEqual(['warn\n'])
    expect(mockBash.exec).toHaveBeenCalledWith('echo hello')
  })

  it('returns non-zero exit code', async () => {
    const mockBash = {
      exec: vi.fn().mockResolvedValue({
        stdout: '',
        stderr: 'not found\n',
        exitCode: 1,
      }),
    }

    const code = await execCommand(
      mockBash as any,
      'bad-command',
      () => {},
      () => {},
    )

    expect(code).toBe(1)
  })

  it('does not call write when stdout/stderr are empty', async () => {
    const mockBash = {
      exec: vi.fn().mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      }),
    }

    const stdout = vi.fn()
    const stderr = vi.fn()

    await execCommand(mockBash as any, 'true', stdout, stderr)

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })
})

describe('makeBash', () => {
  it('creates a read-only overlay filesystem', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reposh-test-'))
    const prefix = '/repos/github.com/test/repo'
    const bash = makeBash(dir, prefix)
    const result = await bash.exec('touch /repos/github.com/test/repo/newfile')

    expect(result.exitCode).not.toBe(0)
  })
})
