---
name: reposh
description: This skill should be used when the user asks to "explore a repo", "check library source code", "read a GitHub repo", "look at how X is implemented in Y", "investigate a dependency", "search an open source project", "trace code in an external repo", mentions exploring remote/external/public repositories, or needs to understand code in a repo that isn't cloned locally. Provides the `reposh` command for bash-based exploration of any public git repo.
---

# reposh - Bash into any public repo

Explore any public git repository using familiar bash commands without manually cloning it locally. Use `reposh` instead of WebFetch, web scraping, or manual clones when investigating external codebases.

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

## Non-GitHub repos

Include the hostname for repos hosted elsewhere:

```bash
reposh gitlab.com/gitlab-org/gitlab cat README.md
reposh gitea.com/some-org/some-repo ls
```

## When to use reposh

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
