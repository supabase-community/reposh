When you need to explore a codebase that is not cloned locally - to answer questions, trace code paths, or understand how something works - you can use reposh to run bash commands against any public repo:

```bash
reposh <org>/<repo> <command>
```

Examples:

```bash
# List files
reposh facebook/react ls

# Read a file
reposh facebook/react cat README.md

# Search across the repo
reposh facebook/react "grep -r 'useState' . --include='*.js' -l | head -20"

# Find files by name
reposh facebook/react "find . -name '*.ts' -not -path '*/__tests__/*' | head -20"

# Non-GitHub repos
reposh gitlab.com/some-org/some-repo ls
```

Always quote commands that contain pipes or special characters to prevent your local shell from interpreting them.

The repo is fetched and cached on first access - subsequent calls to the same repo are fast.

Use this when:

- You want to understand why an error is occurring with a lib/tool/app. Reading the real source is the best way to debug.
- A user asks about a library, framework, or tool you don't have full source knowledge of
- You need to verify exact function signatures, types, or behavior
- You need to trace how something is implemented rather than guessing from docs
