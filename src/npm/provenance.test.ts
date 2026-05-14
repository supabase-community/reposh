import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAttestationBundle } from './provenance.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/sigstore-sign-attestation.json'), 'utf8'),
)

describe('parseAttestationBundle', () => {
  it('extracts source repo and commit from a real provenance bundle', () => {
    const result = parseAttestationBundle(fixture)
    expect(result).toBeDefined()
    expect(result?.host).toBe('github.com')
    // The org/repo depends on which package fixture you chose:
    expect(result?.org).toMatch(/^[a-zA-Z0-9-]+$/)
    expect(result?.repo).toMatch(/^[a-zA-Z0-9._-]+$/)
    expect(result?.sha).toMatch(/^[a-f0-9]{40}$/)
  })

  it('returns undefined when payload has no attestations', () => {
    expect(parseAttestationBundle({ attestations: [] })).toBeUndefined()
    expect(parseAttestationBundle({})).toBeUndefined()
    expect(parseAttestationBundle(null)).toBeUndefined()
  })

  it('returns undefined when no SLSA provenance attestation is present', () => {
    expect(parseAttestationBundle({
      attestations: [{ predicateType: 'something-else', bundle: {} }],
    })).toBeUndefined()
  })
})
