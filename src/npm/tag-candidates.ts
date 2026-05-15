/**
 * For a given npm <name>@<version>, return candidate git tag patterns to try
 * in priority order. Used as a fallback when provenance isn't available and
 * we have to guess the tag from package.json#repository.
 *
 * Scoped names are flattened: `@types/node` -> `types-node`.
 */
export function tagCandidates(name: string, version: string): string[] {
  const flat = name.startsWith('@')
    ? name.slice(1).replace('/', '-')
    : name

  return [
    `v${version}`,
    version,
    `${flat}@${version}`,
    `${flat}-v${version}`,
    `${flat}-${version}`,
  ]
}
