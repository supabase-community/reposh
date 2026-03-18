import { describe, it, expect } from 'vitest'
import { checkAllowlist } from './allowlist.js'
import type { RepoTarget, AllowlistEntry } from './types.js'

const supabaseTarget: RepoTarget = { host: 'github.com', org: 'supabase', repo: 'postgres' }
const facebookTarget: RepoTarget = { host: 'github.com', org: 'facebook', repo: 'react' }
const gitlabTarget: RepoTarget = { host: 'gitlab.com', org: 'myorg', repo: 'myrepo' }

describe('checkAllowlist', () => {
  it('allows all when no allowlist provided', () => {
    expect(() => checkAllowlist(supabaseTarget)).not.toThrow()
    expect(() => checkAllowlist(supabaseTarget, undefined)).not.toThrow()
    expect(() => checkAllowlist(supabaseTarget, [])).not.toThrow()
  })

  it('allows matching org', () => {
    const allowlist: AllowlistEntry[] = [{ host: 'github.com', org: 'supabase' }]
    expect(() => checkAllowlist(supabaseTarget, allowlist)).not.toThrow()
  })

  it('rejects non-matching org', () => {
    const allowlist: AllowlistEntry[] = [{ host: 'github.com', org: 'supabase' }]
    expect(() => checkAllowlist(facebookTarget, allowlist)).toThrow(
      'Access denied: facebook/react is not in the allowlist',
    )
  })

  it('rejects non-matching host', () => {
    const allowlist: AllowlistEntry[] = [{ host: 'github.com', org: 'myorg' }]
    expect(() => checkAllowlist(gitlabTarget, allowlist)).toThrow(
      'Access denied: gitlab.com/myorg/myrepo is not in the allowlist',
    )
  })

  it('allows matching repo when repos is specified', () => {
    const allowlist: AllowlistEntry[] = [{ host: 'github.com', org: 'supabase', repos: ['postgres', 'auth'] }]
    expect(() => checkAllowlist(supabaseTarget, allowlist)).not.toThrow()
  })

  it('rejects non-matching repo when repos is specified', () => {
    const allowlist: AllowlistEntry[] = [{ host: 'github.com', org: 'supabase', repos: ['auth'] }]
    expect(() => checkAllowlist(supabaseTarget, allowlist)).toThrow(
      'Access denied: supabase/postgres is not in the allowlist',
    )
  })

  it('allows any repo when repos is omitted', () => {
    const allowlist: AllowlistEntry[] = [{ host: 'github.com', org: 'supabase' }]
    const other: RepoTarget = { host: 'github.com', org: 'supabase', repo: 'auth' }
    expect(() => checkAllowlist(supabaseTarget, allowlist)).not.toThrow()
    expect(() => checkAllowlist(other, allowlist)).not.toThrow()
  })

  it('matches against multiple entries', () => {
    const allowlist: AllowlistEntry[] = [
      { host: 'github.com', org: 'supabase' },
      { host: 'github.com', org: 'facebook' },
    ]
    expect(() => checkAllowlist(supabaseTarget, allowlist)).not.toThrow()
    expect(() => checkAllowlist(facebookTarget, allowlist)).not.toThrow()
    expect(() => checkAllowlist(gitlabTarget, allowlist)).toThrow('Access denied')
  })
})
