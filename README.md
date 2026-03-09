# reposh

> Bash into any public repo

reposh lets agents explore any public repo the same way they explore your local codebase - with `grep`, `find`, `cat`, and the rest of the shell tools they already know. Use this instead of manual clones or fragile web fetches.

Your agent (e.g. Claude Code) just prefixes their bash command with `reposh <org>/<repo>` and the rest works as if the repo were local:

```bash
reposh facebook/react grep -r 'useState' src/
```

## Why?

There's a lot of energy going into writing docs, skills, and rule files to help agents work with external tools and libraries. These have their place, but arguably the best source of truth is - the source itself. Types, behavior, docs, examples - these are all already in the repo, and are always up to date.

Agents are already great at navigating codebases, reposh just extends that to any public repo without any setup as if it were local.

```bash
reposh vercel/next.js cat package.json
reposh torvalds/linux "find . -name '*.h' | xargs grep -l 'spinlock'"
reposh stripe/stripe-node ls src/resources/
```

## Setup

1. Install `reposh`:

   ```bash
   npm install -g reposh
   ```

2. Teach your agent to use it with the [reposh agent skill](#agent-skill):

   ```bash
   npx skills add rabbitholehq/reposh
   ```

## Usage

```bash
reposh <org>/<repo> <bash command>
```

Defaults to GitHub. For repos on other hosts, just include the hostname:

```bash
# GitHub (default)
reposh facebook/react ls

# GitLab
reposh gitlab.com/gitlab-org/gitlab cat README.md

# Any public git host
reposh gitea.com/some-org/some-repo ls
```

## How it works

On first access, a shallow clone (`depth=1`) is created at `~/.reposh/cache/<host>/<org>/<repo>/`. Every command after that runs against the local clone.

Why clone? Agents tend to run a lot of tool calls back to back (and often in parallel) when they're exploring a codebase - listing files, grepping for patterns, reading specific modules. Having the repo on disk means all of those reads are fast, rather than hitting a remote for each one.

Clones are refreshed after 5 minutes of staleness. If a pull fails, it falls back to a fresh clone.

### Sandboxing

Commands run inside [just-bash](https://github.com/vercel-labs/just-bash) - a TypeScript implementation of a bash shell that runs entirely in-process. It does not use a real shell on your host, container, or VM - just a JS runtime emulating common shell commands (`ls`, `cat`, `grep`, `find`, `head`, `tail`, etc.) against a virtual filesystem. See the just-bash [docs](https://github.com/vercel-labs/just-bash) for the full list of supported commands.

Why sandbox? Many agent harnesses generate their permission allowlists based on the top-level command. Sandboxing means you can allowlist `reposh` once and trust that any shell command the agent runs is limited to the virtual commands built-in to the just-bash emulator and scoped to the specified repo.

It also means you don't need to worry about what's in the repos themselves. Commands are read-only and sandboxed, so there's no chance of accidentally running something destructive from an unfamiliar codebase.

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

**A note on `github.com`** - Claude Code's sandbox docs [discourage](https://code.claude.com/docs/en/sandboxing) broadly allowing `github.com` since it could be used for data exfiltration. reposh only needs it for read-only `git clone` and `git pull`, but the sandbox can't scope permissions to specific operations. This is the same tradeoff any git-based tool faces in sandbox mode.

To avoid allowing `github.com` (or any other host) entirely, you can pre-cache repos before starting a sandboxed session:

```bash
reposh cache facebook/react vercel/next.js
```

This clones the repos ahead of time. If network is unavailable when the cache goes stale, reposh falls back to the stale copy rather than failing - so pre-cached repos keep working indefinitely without `allowedDomains`.

## Agent skill

reposh ships with an [agent skill](https://github.com/vercel-labs/skills) that teaches your agent when and how to use reposh. Install it with:

```bash
npx skills add rabbitholehq/reposh
```

This works across Claude Code, Cursor, Codex, and [37+ other agents](https://github.com/vercel-labs/skills#supported-agents). Once installed, your agent will automatically reach for reposh when it needs to explore an external codebase - no prompting required.

## License

MIT License. See [LICENSE](LICENSE).
