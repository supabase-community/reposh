import { describe, it, expect } from 'vitest'
import { parseRepoTarget, formatRepoTarget, resolveRepoTarget } from './parse-target.js'

describe('parseRepoTarget', () => {
  it('parses org/repo as github.com target', () => {
    expect(parseRepoTarget('facebook/react')).toEqual({
      host: 'github.com',
      org: 'facebook',
      repo: 'react',
    })
  })

  it('parses host/org/repo as custom host target', () => {
    expect(parseRepoTarget('gitlab.com/user/project')).toEqual({
      host: 'gitlab.com',
      org: 'user',
      repo: 'project',
    })
  })

  it('returns null for empty string', () => {
    expect(parseRepoTarget('')).toBeUndefined()
  })

  it('returns null for single component', () => {
    expect(parseRepoTarget('react')).toBeUndefined()
  })

  it('returns null for too many components', () => {
    expect(parseRepoTarget('a/b/c/d')).toBeUndefined()
  })

  it('returns null for three parts where first has no dot', () => {
    expect(parseRepoTarget('notahost/org/repo')).toBeUndefined()
  })

  it('rejects unsafe characters in org', () => {
    expect(parseRepoTarget('or g/repo')).toBeUndefined()
  })

  it('rejects unsafe characters in repo', () => {
    expect(parseRepoTarget('org/re po')).toBeUndefined()
  })

  it('rejects unsafe characters in host', () => {
    expect(parseRepoTarget('git lab.com/org/repo')).toBeUndefined()
  })

  it('allows dots, underscores, and hyphens', () => {
    expect(parseRepoTarget('my-org/my_repo.js')).toEqual({
      host: 'github.com',
      org: 'my-org',
      repo: 'my_repo.js',
    })
  })

  it('allows dots in host for custom hosts', () => {
    expect(parseRepoTarget('git.example.co.uk/org/repo')).toEqual({
      host: 'git.example.co.uk',
      org: 'org',
      repo: 'repo',
    })
  })

  it('rejects path traversal as host', () => {
    expect(parseRepoTarget('../evil/repo')).toBeUndefined()
  })

  it('rejects host without a valid TLD', () => {
    expect(parseRepoTarget('localhost/org/repo')).toBeUndefined()
  })

  it('rejects host with trailing dot', () => {
    expect(parseRepoTarget('github.com./org/repo')).toBeUndefined()
  })

  it('rejects host with single-char TLD', () => {
    expect(parseRepoTarget('example.c/org/repo')).toBeUndefined()
  })

  // --- ref parsing ---

  it('parses org/repo:ref with branch', () => {
    expect(parseRepoTarget('facebook/react:main')).toEqual({
      host: 'github.com', org: 'facebook', repo: 'react', ref: 'main',
    })
  })

  it('parses org/repo:ref with tag', () => {
    expect(parseRepoTarget('facebook/react:v18.2.0')).toEqual({
      host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
  })

  it('parses host/org/repo:ref', () => {
    expect(parseRepoTarget('gitlab.com/user/project:develop')).toEqual({
      host: 'gitlab.com', org: 'user', repo: 'project', ref: 'develop',
    })
  })

  it('parses ref with slashes (feature branches)', () => {
    expect(parseRepoTarget('facebook/react:feature/hooks')).toEqual({
      host: 'github.com', org: 'facebook', repo: 'react', ref: 'feature/hooks',
    })
  })

  it('parses ref with dots and hyphens', () => {
    expect(parseRepoTarget('org/repo:release-1.0.0')).toEqual({
      host: 'github.com', org: 'org', repo: 'repo', ref: 'release-1.0.0',
    })
  })

  it('parses single-char ref', () => {
    expect(parseRepoTarget('org/repo:v')).toEqual({
      host: 'github.com', org: 'org', repo: 'repo', ref: 'v',
    })
  })

  it('returns no ref field when no colon', () => {
    const result = parseRepoTarget('facebook/react')
    expect(result).toEqual({ host: 'github.com', org: 'facebook', repo: 'react' })
    expect(result?.ref).toBeUndefined()
  })

  it('rejects empty ref after colon', () => {
    expect(parseRepoTarget('org/repo:')).toBeUndefined()
  })

  it('rejects ref with path traversal (..)', () => {
    expect(parseRepoTarget('org/repo:../evil')).toBeUndefined()
  })

  it('rejects ref ending with .lock', () => {
    expect(parseRepoTarget('org/repo:branch.lock')).toBeUndefined()
  })

  it('rejects ref with spaces', () => {
    expect(parseRepoTarget('org/repo:my branch')).toBeUndefined()
  })

  it('rejects ref starting with dash', () => {
    expect(parseRepoTarget('org/repo:-flag')).toBeUndefined()
  })

  it('rejects ref with double slashes', () => {
    expect(parseRepoTarget('org/repo:feature//bad')).toBeUndefined()
  })

  it('rejects ref ending with slash', () => {
    expect(parseRepoTarget('org/repo:feature/')).toBeUndefined()
  })

  it('parses ref with @ (monorepo tags like ai@6.0.139)', () => {
    expect(parseRepoTarget('vercel/ai:ai@6.0.139')).toEqual({
      host: 'github.com', org: 'vercel', repo: 'ai', ref: 'ai@6.0.139',
    })
  })

  it('parses ref with @ and slashes', () => {
    expect(parseRepoTarget('org/repo:@scope/pkg@1.0.0')).toEqual({
      host: 'github.com', org: 'org', repo: 'repo', ref: '@scope/pkg@1.0.0',
    })
  })

  it('parses ref with + (semver build metadata)', () => {
    expect(parseRepoTarget('org/repo:v1.0.0+build.123')).toEqual({
      host: 'github.com', org: 'org', repo: 'repo', ref: 'v1.0.0+build.123',
    })
  })
})

describe('formatRepoTarget', () => {
  it('formats github.com target as org/repo shorthand', () => {
    expect(formatRepoTarget({ host: 'github.com', org: 'facebook', repo: 'react' }))
      .toBe('facebook/react')
  })

  it('includes host for non-github targets', () => {
    expect(formatRepoTarget({ host: 'gitlab.com', org: 'user', repo: 'project' }))
      .toBe('gitlab.com/user/project')
  })

  it('appends :ref when ref is present', () => {
    expect(formatRepoTarget({ host: 'github.com', org: 'org', repo: 'repo', ref: 'main' }))
      .toBe('org/repo:main')
  })

  it('appends :ref for custom host with ref', () => {
    expect(formatRepoTarget({ host: 'gitlab.com', org: 'user', repo: 'project', ref: 'v2.0' }))
      .toBe('gitlab.com/user/project:v2.0')
  })

  it('handles ref with slashes', () => {
    expect(formatRepoTarget({ host: 'github.com', org: 'org', repo: 'repo', ref: 'feature/hooks' }))
      .toBe('org/repo:feature/hooks')
  })

  it('round-trips with parseRepoTarget', () => {
    const inputs = [
      'facebook/react',
      'facebook/react:main',
      'gitlab.com/user/project',
      'gitlab.com/user/project:v1.0',
      'vercel/ai:ai@6.0.139',
    ]
    for (const input of inputs) {
      const parsed = parseRepoTarget(input)!
      expect(formatRepoTarget(parsed)).toBe(input)
    }
  })
})

describe('resolveRepoTarget', () => {
  it('parses a valid string into a RepoTarget', () => {
    expect(resolveRepoTarget('facebook/react')).toEqual({
      host: 'github.com', org: 'facebook', repo: 'react',
    })
  })

  it('passes through a RepoTarget object unchanged', () => {
    const target = { host: 'github.com', org: 'org', repo: 'repo' }
    expect(resolveRepoTarget(target)).toBe(target)
  })

  it('throws on invalid string', () => {
    expect(() => resolveRepoTarget('invalid')).toThrow('Invalid repo target: invalid')
  })

  it('throws on empty string', () => {
    expect(() => resolveRepoTarget('')).toThrow('Invalid repo target: ')
  })

  it('parses string with ref', () => {
    expect(resolveRepoTarget('org/repo:main')).toEqual({
      host: 'github.com', org: 'org', repo: 'repo', ref: 'main',
    })
  })
})
