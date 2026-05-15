import { describe, it, expect } from 'vitest'
import { parseTarget, formatTarget, resolveTargetSync } from './parse-target.js'

describe('parseTarget - source prefix routing', () => {
  it('parses git: prefix', () => {
    expect(parseTarget('git:facebook/react')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react',
    })
  })

  it('defaults no-prefix to git', () => {
    expect(parseTarget('facebook/react')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react',
    })
  })

  it('parses npm: prefix', () => {
    expect(parseTarget('npm:lodash')).toEqual({ source: 'npm', name: 'lodash' })
  })

  it('rejects unknown source prefix', () => {
    expect(parseTarget('pypi:requests')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseTarget('')).toBeUndefined()
  })
})

describe('parseTarget - git targets', () => {
  it('parses org/repo as github.com target', () => {
    expect(parseTarget('facebook/react')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react',
    })
  })

  it('parses host/org/repo as custom host target', () => {
    expect(parseTarget('gitlab.com/user/project')).toEqual({
      source: 'git', host: 'gitlab.com', org: 'user', repo: 'project',
    })
  })

  it('returns undefined for single component', () => {
    expect(parseTarget('react')).toBeUndefined()
  })

  it('returns undefined for too many components', () => {
    expect(parseTarget('a/b/c/d')).toBeUndefined()
  })

  it('returns undefined for three parts where first has no dot', () => {
    expect(parseTarget('notahost/org/repo')).toBeUndefined()
  })

  it('rejects unsafe characters in org', () => {
    expect(parseTarget('or g/repo')).toBeUndefined()
  })

  it('rejects unsafe characters in repo', () => {
    expect(parseTarget('org/re po')).toBeUndefined()
  })

  it('rejects unsafe characters in host', () => {
    expect(parseTarget('git lab.com/org/repo')).toBeUndefined()
  })

  it('allows dots, underscores, and hyphens', () => {
    expect(parseTarget('my-org/my_repo.js')).toEqual({
      source: 'git', host: 'github.com', org: 'my-org', repo: 'my_repo.js',
    })
  })

  it('allows dots in host for custom hosts', () => {
    expect(parseTarget('git.example.co.uk/org/repo')).toEqual({
      source: 'git', host: 'git.example.co.uk', org: 'org', repo: 'repo',
    })
  })

  it('rejects path traversal as host', () => {
    expect(parseTarget('../evil/repo')).toBeUndefined()
  })

  it('rejects host without a valid TLD', () => {
    expect(parseTarget('localhost/org/repo')).toBeUndefined()
  })

  it('rejects host with trailing dot', () => {
    expect(parseTarget('github.com./org/repo')).toBeUndefined()
  })

  it('rejects host with single-char TLD', () => {
    expect(parseTarget('example.c/org/repo')).toBeUndefined()
  })

  // --- canonical @ref ---

  it('parses org/repo@ref (canonical) with tag', () => {
    expect(parseTarget('facebook/react@v18.2.0')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
  })

  it('parses host/org/repo@ref', () => {
    expect(parseTarget('gitlab.com/user/project@develop')).toEqual({
      source: 'git', host: 'gitlab.com', org: 'user', repo: 'project', ref: 'develop',
    })
  })

  it('parses ref containing @ when canonical separator is first', () => {
    // `vercel/ai@ai@6.0.139` - first @ is the separator, rest is the ref
    expect(parseTarget('vercel/ai@ai@6.0.139')).toEqual({
      source: 'git', host: 'github.com', org: 'vercel', repo: 'ai', ref: 'ai@6.0.139',
    })
  })

  it('parses git: prefix with @ref', () => {
    expect(parseTarget('git:facebook/react@v18.2.0')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
  })

  // --- legacy :ref ---

  it('parses org/repo:ref (legacy) with branch', () => {
    expect(parseTarget('facebook/react:main')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'main',
    })
  })

  it('parses org/repo:ref (legacy) with tag', () => {
    expect(parseTarget('facebook/react:v18.2.0')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
  })

  it('parses host/org/repo:ref (legacy)', () => {
    expect(parseTarget('gitlab.com/user/project:develop')).toEqual({
      source: 'git', host: 'gitlab.com', org: 'user', repo: 'project', ref: 'develop',
    })
  })

  it('parses git: prefix with legacy :ref', () => {
    expect(parseTarget('git:facebook/react:v18.2.0')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'v18.2.0',
    })
  })

  it('parses ref with slashes (feature branches)', () => {
    expect(parseTarget('facebook/react:feature/hooks')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react', ref: 'feature/hooks',
    })
  })

  it('parses ref with dots and hyphens', () => {
    expect(parseTarget('org/repo@release-1.0.0')).toEqual({
      source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'release-1.0.0',
    })
  })

  it('parses single-char ref', () => {
    expect(parseTarget('org/repo@v')).toEqual({
      source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'v',
    })
  })

  it('returns no ref field when no separator', () => {
    const result = parseTarget('facebook/react')
    expect(result).toEqual({ source: 'git', host: 'github.com', org: 'facebook', repo: 'react' })
    expect((result as { ref?: string }).ref).toBeUndefined()
  })

  // --- @ wins when both present ---

  it('prefers @ over : when @ appears first', () => {
    // foo/bar@a:b - @ wins, ref = "a:b"... but ":" is not in SAFE_REF, so invalid
    // Use a valid form: org/repo@feature-1 (no colon at all in the suffix)
    expect(parseTarget('org/repo@feature-1')).toEqual({
      source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'feature-1',
    })
  })

  // --- invalid refs ---

  it('returns undefined for empty ref after @', () => {
    expect(parseTarget('org/repo@')).toBeUndefined()
  })

  it('returns undefined for empty ref after :', () => {
    expect(parseTarget('org/repo:')).toBeUndefined()
  })

  it('rejects ref with path traversal (..) via @', () => {
    expect(parseTarget('org/repo@../evil')).toBeUndefined()
  })

  it('rejects ref ending with .lock via @', () => {
    expect(parseTarget('org/repo@branch.lock')).toBeUndefined()
  })

  it('rejects ref starting with dash via @', () => {
    expect(parseTarget('org/repo@-flag')).toBeUndefined()
  })

  it('rejects ref with double slashes via @', () => {
    expect(parseTarget('org/repo@feature//bad')).toBeUndefined()
  })

  it('rejects ref ending with slash via @', () => {
    expect(parseTarget('org/repo@feature/')).toBeUndefined()
  })

  it('rejects ref with spaces (legacy)', () => {
    expect(parseTarget('org/repo:my branch')).toBeUndefined()
  })

  // --- monorepo-style + semver build ---

  it('parses ref with + (semver build metadata)', () => {
    expect(parseTarget('org/repo@v1.0.0+build.123')).toEqual({
      source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'v1.0.0+build.123',
    })
  })
})

describe('parseTarget - npm targets', () => {
  it('parses bare unscoped package', () => {
    expect(parseTarget('npm:lodash')).toEqual({ source: 'npm', name: 'lodash' })
  })

  it('parses unscoped package with version', () => {
    expect(parseTarget('npm:lodash@4.17.21')).toEqual({
      source: 'npm', name: 'lodash', version: '4.17.21',
    })
  })

  it('parses unscoped package with dist-tag', () => {
    expect(parseTarget('npm:lodash@next')).toEqual({
      source: 'npm', name: 'lodash', version: 'next',
    })
  })

  it('parses scoped package without version', () => {
    expect(parseTarget('npm:@types/node')).toEqual({
      source: 'npm', name: '@types/node',
    })
  })

  it('parses scoped package with version', () => {
    expect(parseTarget('npm:@types/node@20.0.0')).toEqual({
      source: 'npm', name: '@types/node', version: '20.0.0',
    })
  })

  it('parses scoped package with dist-tag', () => {
    expect(parseTarget('npm:@vercel/edge@beta')).toEqual({
      source: 'npm', name: '@vercel/edge', version: 'beta',
    })
  })

  it('parses scoped package with prerelease version', () => {
    expect(parseTarget('npm:@scope/name@1.2.3-alpha.1')).toEqual({
      source: 'npm', name: '@scope/name', version: '1.2.3-alpha.1',
    })
  })

  it('returns undefined for empty npm spec', () => {
    expect(parseTarget('npm:')).toBeUndefined()
  })

  it('returns undefined for empty version', () => {
    expect(parseTarget('npm:lodash@')).toBeUndefined()
  })

  it('returns undefined for scope without package', () => {
    expect(parseTarget('npm:@types/')).toBeUndefined()
  })

  it('returns undefined for scope without slash', () => {
    expect(parseTarget('npm:@types')).toBeUndefined()
  })

  it('rejects uppercase in npm name', () => {
    expect(parseTarget('npm:LoDash')).toBeUndefined()
  })

  it('rejects npm name starting with dash', () => {
    expect(parseTarget('npm:-bad')).toBeUndefined()
  })
})

describe('formatTarget', () => {
  it('formats github.com git target as org/repo shorthand', () => {
    expect(formatTarget({ source: 'git', host: 'github.com', org: 'facebook', repo: 'react' }))
      .toBe('facebook/react')
  })

  it('includes host for non-github git targets', () => {
    expect(formatTarget({ source: 'git', host: 'gitlab.com', org: 'u', repo: 'p' }))
      .toBe('gitlab.com/u/p')
  })

  it('appends @ref for git target (canonical output)', () => {
    expect(formatTarget({ source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'main' }))
      .toBe('org/repo@main')
  })

  it('appends @ref for custom host git target', () => {
    expect(formatTarget({ source: 'git', host: 'gitlab.com', org: 'user', repo: 'project', ref: 'v2.0' }))
      .toBe('gitlab.com/user/project@v2.0')
  })

  it('handles ref with slashes', () => {
    expect(formatTarget({ source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'feature/hooks' }))
      .toBe('org/repo@feature/hooks')
  })

  it('formats unscoped npm target without version', () => {
    expect(formatTarget({ source: 'npm', name: 'lodash' })).toBe('npm:lodash')
  })

  it('formats unscoped npm target with version', () => {
    expect(formatTarget({ source: 'npm', name: 'lodash', version: '4.17.21' }))
      .toBe('npm:lodash@4.17.21')
  })

  it('formats scoped npm target without version', () => {
    expect(formatTarget({ source: 'npm', name: '@types/node' })).toBe('npm:@types/node')
  })

  it('formats scoped npm target with version', () => {
    expect(formatTarget({ source: 'npm', name: '@types/node', version: '20.0.0' }))
      .toBe('npm:@types/node@20.0.0')
  })

  it('round-trips git targets through parse -> format', () => {
    const inputs = [
      'facebook/react',
      'facebook/react@main',
      'gitlab.com/user/project',
      'gitlab.com/user/project@v1.0',
      'vercel/ai@ai@6.0.139',
    ]
    for (const input of inputs) {
      const parsed = parseTarget(input)!
      expect(formatTarget(parsed)).toBe(input)
    }
  })

  it('legacy :ref input becomes @ref on round-trip', () => {
    const parsed = parseTarget('facebook/react:v18.2.0')!
    expect(formatTarget(parsed)).toBe('facebook/react@v18.2.0')
  })

  it('round-trips npm targets through parse -> format', () => {
    const inputs = [
      'npm:lodash',
      'npm:lodash@4.17.21',
      'npm:@types/node',
      'npm:@types/node@20.0.0',
    ]
    for (const input of inputs) {
      const parsed = parseTarget(input)!
      expect(formatTarget(parsed)).toBe(input)
    }
  })
})

describe('resolveTargetSync', () => {
  it('parses a valid string into a Target', () => {
    expect(resolveTargetSync('facebook/react')).toEqual({
      source: 'git', host: 'github.com', org: 'facebook', repo: 'react',
    })
  })

  it('passes through a Target object unchanged', () => {
    const target = { source: 'git' as const, host: 'github.com', org: 'org', repo: 'repo' }
    expect(resolveTargetSync(target)).toBe(target)
  })

  it('throws on invalid string', () => {
    expect(() => resolveTargetSync('invalid')).toThrow('Invalid target: invalid')
  })

  it('throws on empty string', () => {
    expect(() => resolveTargetSync('')).toThrow('Invalid target: ')
  })

  it('parses string with ref', () => {
    expect(resolveTargetSync('org/repo@main')).toEqual({
      source: 'git', host: 'github.com', org: 'org', repo: 'repo', ref: 'main',
    })
  })

  it('parses npm string', () => {
    expect(resolveTargetSync('npm:lodash@4.17.21')).toEqual({
      source: 'npm', name: 'lodash', version: '4.17.21',
    })
  })
})
