---
name: reposh
description: This skill should be used when the user asks to "explore a repo", "check library source code", "read a GitHub repo", "look at how X is implemented in Y", "investigate a dependency", "search an open source project", "trace code in an external repo", mentions exploring remote/external/public repositories, or needs to understand code in a repo that isn't cloned locally. Provides the `reposh` command for bash-based exploration of any public git repo.
---

# reposh - Bash into any public repo

Explore any public git repository using familiar bash commands without manually cloning it locally. Use `reposh` instead of WebFetch, web scraping, or manual clones when investigating external codebases.

## Install

reposh is likely already installed globally. If not:

```bash
npm install -g reposh
```

## Usage

```bash
reposh <org>/<repo> <command>
```

Under the hood the repo is shallow-cloned and cached on first access. All subsequent commands against the same repo are fast.

## Commands

```bash
# List files
reposh facebook/react ls
reposh facebook/react ls src/

# Read files
reposh facebook/react cat README.md
reposh facebook/react cat src/ReactElement.js

# Search across the repo
reposh facebook/react "grep -r 'useState' . --include='*.js' -l | head -20"

# Find files by name
reposh facebook/react "find . -name '*.ts' -not -path '*/__tests__/*' | head -20"

# Combine commands with pipes
reposh stripe/stripe-node "find . -name '*.ts' | head -30"
reposh vercel/next.js "grep -rl 'middleware' src/ | head -10"
```

Always quote commands containing pipes or special characters to prevent the local shell from interpreting them.

## Reading installed npm dependencies

Use the `npm:` prefix to read the source of an installed npm dependency. reposh resolves to the version installed in the user's local project automatically (via node's standard `require.resolve`, works with npm/pnpm/yarn/bun):

```bash
reposh npm:lodash cat lodash.js          # uses the user's installed version
reposh npm:@types/node cat package.json
```

You don't need to read the lockfile yourself - just pass the package name. If the package isn't installed locally, reposh falls back to the registry's latest. If you want a specific version regardless of what's installed, pin it explicitly:

```bash
reposh npm:lodash@4.17.21 cat package.json   # exact version
reposh npm:react@next ls                      # dist-tag
reposh npm:lodash@latest ls                   # explicit latest (bypasses local lookup)
```

reposh handles resolving to the right repo and commit via npm provenance attestations or the package.json `repository` field.

## Browsing a specific git ref

If you already know the exact GitHub repo and ref (branch, tag, or commit SHA):

```bash
reposh <org>/<repo>@<tag-or-branch> <command>
```

This is especially useful when investigating dependencies in non-npm ecosystems. Check what version the user has installed (in pyproject.toml, Cargo.toml, go.mod, etc.), then explore that exact version's source:

```bash
reposh facebook/react@v18.2.0 cat packages/react/src/React.js
reposh vercel/next.js@canary ls src/
reposh pallets/flask@3.1.1 cat src/flask/app.py
```

Without `@ref`, reposh uses the repository's default branch - which may have unreleased changes that don't match the version the user has installed. Tags typically follow the project's release naming convention (v1.0.0, 1.0.0, etc.) - check the repo's releases or tags if unsure.

## Non-GitHub repos

Include the hostname for repos hosted elsewhere:

```bash
reposh gitlab.com/gitlab-org/gitlab cat README.md
reposh gitea.com/some-org/some-repo ls
```

## When to use reposh

- Reading the source of an installed npm dependency at its installed version
- Investigating a specific version of a dependency the user has installed
- Debugging errors from a library - reading the actual source beats guessing from docs
- Verifying exact function signatures, types, or behavior
- Tracing how something is implemented end-to-end
- Answering questions about a library, framework, or tool
- Comparing implementations across projects

## Exploration patterns

### Orientation - get the lay of the land

```bash
reposh <org>/<repo> ls
reposh <org>/<repo> cat README.md
reposh <org>/<repo> cat package.json   # or pyproject.toml, Cargo.toml, etc.
reposh <org>/<repo> "find . -maxdepth 2 -type f | head -40"
```

### Finding relevant code

```bash
reposh <org>/<repo> "grep -r 'functionName' . --include='*.ts' -l"
reposh <org>/<repo> "grep -rn 'className' src/ --include='*.py' | head -20"
reposh <org>/<repo> "find . -name '*.go' -path '*/api/*'"
```

### Deep dive - read and trace

```bash
reposh <org>/<repo> cat src/core/module.ts
reposh <org>/<repo> "grep -n 'export' src/index.ts"
reposh <org>/<repo> "cat src/utils.ts | head -50"
```

## npm resolution errors

If reposh can't resolve an `npm:` target (e.g. no provenance and no matching tag), it produces a progressive error showing how far it got, including the resolved git repo when known. You can fall back to a direct `<org>/<repo>@<tag>` target in that case.

## Subagent usage

For complex exploration tasks that require many commands (tracing a code path, understanding an architecture, comparing multiple files), spawn a subagent to keep the main context clean:

```
Use the Agent tool with subagent_type "general-purpose" and a prompt like:
"Use reposh to explore <org>/<repo> and answer: <question>.
Run: reposh <org>/<repo> <command>"
```

For quick lookups (checking a type signature, reading a single file), run reposh directly without a subagent.

## Notes

- Commands run in a sandboxed shell (just-bash) - read-only, no network access, no host shell
- Supported commands: ls, cat, grep, find, head, tail, wc, echo, and other common utils
- Clones refresh after 5 minutes of staleness
