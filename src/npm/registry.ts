const REGISTRY_BASE = 'https://registry.npmjs.org'

/** Subset of the npm version manifest we care about. */
export interface NpmVersionManifest {
  name: string
  version: string
  dist?: {
    tarball: string
    attestations?: {
      url: string
      provenance?: { predicateType: string }
    }
  }
  repository?: string | { type?: string; url: string; directory?: string }
}

/** Subset of the npm packument we care about. */
export interface NpmPackument {
  name: string
  'dist-tags': Record<string, string>
}

function encodeNpmName(name: string): string {
  // Scoped packages: encode the `/` as `%2F` per npm registry conventions.
  return name.replace('/', '%2F')
}

async function fetchJson<T>(url: string, notFoundMessage: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (res.status === 404) throw new Error(notFoundMessage)
  if (!res.ok) throw new Error(`Registry request failed: ${res.status} ${res.statusText} (${url})`)
  return res.json() as Promise<T>
}

/** Fetch the version manifest for `name@version` from the npm registry. */
export async function fetchVersionManifest(name: string, version: string): Promise<NpmVersionManifest> {
  const url = `${REGISTRY_BASE}/${encodeNpmName(name)}/${encodeURIComponent(version)}`
  return fetchJson<NpmVersionManifest>(url, `${name}@${version}: package or version not found in npm registry`)
}

/** Fetch the packument (top-level metadata, dist-tags) for a package. */
export async function fetchPackument(name: string): Promise<NpmPackument> {
  const url = `${REGISTRY_BASE}/${encodeNpmName(name)}`
  return fetchJson<NpmPackument>(url, `${name}: package not found in npm registry`)
}

/** Resolve a dist-tag (e.g. `latest`) to a concrete version. */
export async function fetchPackumentDistTag(name: string, tag: string): Promise<string> {
  const packument = await fetchPackument(name)
  const v = packument['dist-tags']?.[tag]
  if (!v) {
    const tagNames = Object.keys(packument['dist-tags'] ?? {})
    const known = tagNames.length > 0 ? tagNames.join(', ') : 'none'
    throw new Error(`${name}@${tag}: dist-tag not found (known: ${known})`)
  }
  return v
}

/**
 * Fetch the attestations payload (an object with an `attestations` array)
 * for a given package@version. Throws with sentinel `NO_ATTESTATIONS` if the
 * package was not published with provenance. Other errors propagate.
 */
export async function fetchAttestations(name: string, version: string): Promise<unknown> {
  const manifest = await fetchVersionManifest(name, version)
  const url = manifest.dist?.attestations?.url
  if (!url) throw new Error('NO_ATTESTATIONS')
  return fetchJson<unknown>(url, `attestations payload missing for ${name}@${version}`)
}
