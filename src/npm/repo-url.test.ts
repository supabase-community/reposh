import { describe, it, expect } from 'vitest'
import { parseRepositoryField } from './repo-url.js'

describe('parseRepositoryField', () => {
  it('parses string form', () => {
    expect(parseRepositoryField('https://github.com/lodash/lodash')).toEqual({
      host: 'github.com', org: 'lodash', repo: 'lodash',
    })
  })

  it('parses object form with url', () => {
    expect(parseRepositoryField({ type: 'git', url: 'https://github.com/lodash/lodash.git' })).toEqual({
      host: 'github.com', org: 'lodash', repo: 'lodash',
    })
  })

  it('parses git+https URLs', () => {
    expect(parseRepositoryField('git+https://github.com/foo/bar.git')).toEqual({
      host: 'github.com', org: 'foo', repo: 'bar',
    })
  })

  it('parses github: shorthand', () => {
    expect(parseRepositoryField('github:foo/bar')).toEqual({
      host: 'github.com', org: 'foo', repo: 'bar',
    })
  })

  it('parses gitlab: shorthand', () => {
    expect(parseRepositoryField('gitlab:foo/bar')).toEqual({
      host: 'gitlab.com', org: 'foo', repo: 'bar',
    })
  })

  it('parses ssh-style URLs', () => {
    expect(parseRepositoryField('git@github.com:foo/bar.git')).toEqual({
      host: 'github.com', org: 'foo', repo: 'bar',
    })
  })

  it('parses gitlab URLs', () => {
    expect(parseRepositoryField('https://gitlab.com/group/project')).toEqual({
      host: 'gitlab.com', org: 'group', repo: 'project',
    })
  })

  it('returns undefined for missing repository', () => {
    expect(parseRepositoryField(undefined)).toBeUndefined()
    expect(parseRepositoryField('')).toBeUndefined()
    expect(parseRepositoryField({ type: 'git', url: '' })).toBeUndefined()
  })

  it('returns undefined for unsupported protocol', () => {
    expect(parseRepositoryField('svn://example.com/foo/bar')).toBeUndefined()
  })
})
