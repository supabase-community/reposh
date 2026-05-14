import { describe, it, expect } from 'vitest'
import {
  fetchVersionManifest,
  fetchPackument,
  fetchPackumentDistTag,
  fetchAttestations,
} from './registry.js'

describe('npm registry client', () => {
  it('fetches a version manifest for an unscoped package', async () => {
    const m = await fetchVersionManifest('lodash', '4.17.21')
    expect(m.name).toBe('lodash')
    expect(m.version).toBe('4.17.21')
    expect(m.repository).toBeDefined()
  })

  it('fetches a version manifest for a scoped package', async () => {
    const m = await fetchVersionManifest('@types/node', '20.0.0')
    expect(m.name).toBe('@types/node')
    expect(m.version).toBe('20.0.0')
  })

  it('resolves a dist-tag to a version', async () => {
    const version = await fetchPackumentDistTag('lodash', 'latest')
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('throws clear error for missing package', async () => {
    await expect(fetchVersionManifest('this-package-truly-does-not-exist-xyz-123', '1.0.0'))
      .rejects.toThrow(/not found/i)
  })

  it('throws clear error for missing version', async () => {
    await expect(fetchVersionManifest('lodash', '99.99.99'))
      .rejects.toThrow(/not found/i)
  })

  it('fetches attestations for a package published with provenance', async () => {
    // Use a known-provenanced package. @sigstore/sign has provenance attestations.
    // If this specific version goes away, pick any current version with provenance.
    const payload = await fetchAttestations('@sigstore/sign', '3.0.0')
    expect(payload).toBeDefined()
    expect((payload as { attestations?: unknown[] }).attestations).toBeInstanceOf(Array)
  })

  it('throws NO_ATTESTATIONS for a package without provenance', async () => {
    await expect(fetchAttestations('lodash', '4.17.21')).rejects.toThrow('NO_ATTESTATIONS')
  })

  it('also exposes fetchPackument', async () => {
    const p = await fetchPackument('lodash')
    expect(p.name).toBe('lodash')
    expect(p['dist-tags']).toBeDefined()
  })
})
