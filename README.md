# reposh

> Bash into any public repo

reposh lets agents explore any public repo the same way they explore your local codebase - with `grep`, `find`, `cat`, and the rest of the shell tools they already know. Use this when you want to explore other codebases without manual clones or opaque web fetches.

Your coding agent (e.g. Claude Code) just prefixes their bash command with `reposh <org>/<repo>` and the rest works as if your shell was running in that repo:

```bash
reposh colinhacks/zod grep -rl 'ZodError' packages/zod/src/
```

## Why?

There's a lot of energy going into writing docs, skills, and rule files to help agents work with external tools and libraries. These have their place, but sometimes the best source of truth is - the source itself. If you're looking for behavior, types, examples, or docs - most of that already lives in the repo, and it's always up to date.

Agents are great at navigating codebases, reposh just extends that to any public repo without any setup.

```bash
reposh colinhacks/zod cat packages/zod/src/index.ts
reposh tailwindlabs/tailwindcss grep -rl 'theme' packages/tailwindcss/src/
reposh supabase/supabase ls apps/
```

See [how it works](#how-it-works) for details on the local caching and sandboxing implementation.

## Prerequisites

- [git](https://git-scm.com/) must be installed and available on your `PATH`. reposh uses it to clone and fetch repos (see [how it works](#how-it-works)).

## Setup

1. Install `reposh`:

   ```bash
   npm install -g reposh
   ```

2. Teach your agent to use it with the [agent skill](#agent-skill):

   ```bash
   npx skills add supabase-community/reposh
   ```

## Usage

reposh is designed to be used by LLMs. Once you've [installed the skill](#agent-skill), your agent will know when and how to reach for it. If you prefer to build the prompt yourself, the skill source is in [SKILL.md](skills/reposh/SKILL.md).

You can also use it directly from the terminal:

```bash
reposh <org>/<repo>[:ref] <bash command>
```

Append `:ref` to target a specific branch or tag:

```bash
reposh facebook/react:v18.2.0 cat package.json
reposh vercel/next.js:canary ls src/
reposh gitlab.com/org/project:main ls
```

Without `:ref`, reposh uses the repository's default branch. Commit hashes are not currently supported.

### Non-GitHub repos

Defaults to GitHub. For repos on other hosts, just include the hostname:

```bash
# GitHub (default)
reposh facebook/react ls

# GitLab
reposh gitlab.com/gitlab-org/gitlab cat README.md

# Any public git host
reposh gitea.com/some-org/some-repo ls
```

Repos are always accessed over HTTPS.

## How it works

On first access, a shallow clone (`depth=1`) is created at `~/.reposh/cache/<host>/<org>/<repo>/`. Every command after that runs against the local clone. When you request a specific branch or tag, reposh uses git worktrees to share the object store with the main clone - so only new/different objects are fetched.

Why clone vs web fetch? Agents tend to run a lot of tool calls back to back (and often in parallel) when they're exploring a codebase (listing files, grepping for patterns, reading modules). Having the repo on disk means all of those reads are fast, rather than hitting a remote for each one. The tradeoff is a one-time delay on first access while the repo clones, but every command after that runs at local speed.

Clones are refreshed with a `git fetch` after 30 minutes of staleness. If the fetch fails (e.g. you're offline), it serves the stale cache. You can also [pre-cache repos](#cache-management) ahead of time.

### Sandboxing

Commands run inside [just-bash](https://github.com/vercel-labs/just-bash) - a TypeScript implementation of a bash shell that runs entirely in-process. It does not use a real shell on your host, container, or VM - just a JS runtime emulating common shell commands (`ls`, `cat`, `grep`, `find`, `head`, `tail`, etc.) against a virtual filesystem. See the just-bash [docs](https://github.com/vercel-labs/just-bash) for the full list of supported commands.

Why sandbox? Many agent harnesses generate their permission allowlists based on the top-level command. Sandboxing means you can allowlist `reposh` once and trust that any shell command the agent runs is limited to the virtual read-only commands built-in to the just-bash emulator and scoped to the specified repo.

It also means you don't need to worry about what's in the repos themselves. Commands are read-only and sandboxed, so there's no way to accidentally run something destructive from an unfamiliar codebase.

## Claude Code sandbox mode

If you're running Claude Code with [sandbox mode](https://code.claude.com/docs/en/sandboxing) enabled, reposh needs two things that the sandbox restricts by default:

1. **Network access** - reposh clones repos over HTTPS, so it needs to reach your git host
2. **Filesystem writes outside CWD** - clones are cached in `~/.reposh/cache/`

Add this to your `settings.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "filesystem": {
      "allowWrite": ["~/.reposh"]
    },
    "allowedDomains": ["github.com"]
  }
}
```

If you're accessing repos on other hosts, add those too:

```json
{
  "sandbox": {
    "allowedDomains": ["github.com", "gitlab.com", "gitea.com"]
  }
}
```

**A note on `github.com`** - Claude Code's sandbox docs [discourage](https://code.claude.com/docs/en/sandboxing) broadly allowing `github.com` since it could be used for data exfiltration. reposh only needs it for read-only `git clone` and `git fetch`, but the sandbox can't scope permissions to specific operations. This is the same tradeoff any git-based tool faces in sandbox mode.

To avoid allowing `github.com` (or any other host) entirely, you can [pre-cache](#cache-management) repos before starting a sandboxed session.

## Cache management

To pre-cache a repo (e.g. if you want the repo to be available offline):

```bash
reposh cache add facebook/react vercel/next.js
```

This clones the repos ahead of time. If network is unavailable when the cache goes stale, reposh falls back to the stale copy.

You can also list, inspect, and clean up cached repos:

```bash
reposh cache ls                     # list cached repos with sizes
reposh cache rm facebook/react      # remove a repo and its worktrees
reposh cache rm facebook/react:v18  # remove a single worktree
reposh cache rm --all               # clear the entire cache
```

## Windows

Windows is not currently supported, but it's on the roadmap. The [just-bash](https://github.com/vercel-labs/just-bash) sandboxed shell has a path separator bug in its `OverlayFs` that prevents file reads on Windows (directory listings work, but `cat`, `head`, etc. fail). We're working on a fix upstream!

## Agent skill

reposh ships with an [agent skill](https://agentskills.io/home) that teaches your agent when and how to use reposh. Install it with:

```bash
npx skills add supabase-community/reposh
```

This works across Claude Code, Cursor, Codex, and [37+ other agents](https://github.com/vercel-labs/skills#supported-agents). Once installed, your agent will automatically reach for reposh when it needs to explore an external codebase.

## Library

reposh exposes its caching and access logic as a library so you can build your own tools on top of it.

```bash
npm install reposh
```

```ts
import { createRepoCache } from 'reposh';

const cache = createRepoCache({
  allowlist: [{ host: 'github.com', org: 'supabase' }],
});

// Clone or refresh a repo, returns the local path
const dir = await cache.ensureRepo('supabase/postgres', {
  onProgress: console.log,
});

// List all cached repos
const repos = await cache.listRepos();

// Remove a cached repo
await cache.removeRepo('supabase/postgres');
```

### `createRepoCache(config?)`

Returns a `RepoCache` instance. All config fields are optional - defaults to `~/.reposh/cache`, 30 minute TTL, no allowlist (any repo can be accessed).

| Option      | Type               | Default            | Description                                 |
| ----------- | ------------------ | ------------------ | ------------------------------------------- |
| `cacheDir`  | `string`           | `~/.reposh/cache`  | Where clones are stored                     |
| `cacheTtl`  | `number`           | `1800000` (30 min) | How long before a clone is considered stale |
| `allowlist` | `AllowlistEntry[]` | `undefined`        | Restrict which orgs/repos can be accessed   |

### `RepoCache`

| Method                      | Description                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ensureRepo(target, opts?)` | Clone or refresh a repo. Returns the local path. Accepts `'org/repo'`, `'org/repo:ref'`, or a `RepoTarget` object. Options: `onProgress`, `force`. |
| `listRepos()`               | List all cached repos with metadata.                                                                                                               |
| `removeRepo(target)`        | Remove a cached repo and its worktrees.                                                                                                            |

### Allowlist

When an allowlist is provided, only matching repos can be accessed via `ensureRepo`. Omit `repos` to allow all repos in an org.

```ts
const cache = createRepoCache({
  allowlist: [
    { host: 'github.com', org: 'supabase' }, // all supabase repos
    { host: 'github.com', org: 'facebook', repos: ['react', 'jest'] }, // specific repos only
  ],
});
```

### Utilities

```ts
import { parseRepoTarget, formatRepoTarget } from 'reposh';

parseRepoTarget('supabase/postgres'); // { host: 'github.com', org: 'supabase', repo: 'postgres' }
parseRepoTarget('invalid'); // undefined

formatRepoTarget({ host: 'github.com', org: 'supabase', repo: 'postgres' }); // 'supabase/postgres'
```

## License

MIT License. See [LICENSE](LICENSE).
