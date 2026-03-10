import { describe, it, expect } from 'vitest'
import { parseRepoTarget } from './parse-target.js'

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
})
