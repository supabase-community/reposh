# reposh

> Bash into any public repo

reposh lets agents explore any public repo the same way they explore your local codebase - with `grep`, `find`, `cat`, and the rest of the shell tools they already know. Use this instead of manual clones or fragile web fetches.

```bash
npm i -g reposh

# Your agent (e.g. claude code) runs:
reposh facebook/react grep -r 'useState' src/
```

Your agent just needs to prefix their bash command with `reposh <org>/<repo>` and the rest works as if the repo were local.

## Why?

There's a lot of energy going into writing docs, skills, and rule files to help agents work with external tools and libraries. These have their place, but arguably the best source of truth is - the source itself. Types, behavior, docs, examples - these are all already in the repo, and are always up to date.

Agents are already great at navigating codebases, reposh just extends that to any public repo without any setup as if it were local.

```bash
reposh vercel/next.js cat package.json
reposh torvalds/linux "find . -name '*.h' | xargs grep -l 'spinlock'"
reposh stripe/stripe-node ls src/resources/
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

## License

MIT License. See [LICENSE](LICENSE).
