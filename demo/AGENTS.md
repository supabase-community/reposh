When you need to explore a codebase that is not cloned locally - to answer questions, trace code paths, or understand how something works - you can access any public GitHub repo over SSH without cloning it yourself:

```bash
ssh <org>/<repo>@reposh <command>
```

Examples:

```bash
# List files
ssh supabase/supabase@reposh ls

# Read a file
ssh supabase/supabase@reposh cat README.md

# Search across the repo
ssh supabase/supabase@reposh "grep -r 'createClient' src/ | head -20"

# Find files by name
ssh supabase/supabase@reposh "find . -name '*.ts' | head -20"

# Explicit host for non-GitHub repos
ssh gitlab.com/some-org/some-repo@reposh ls
```

Always quote commands that contain pipes or special characters to prevent your local shell from interpreting them.

The repo is fetched and cached on first access - subsequent calls to the same repo are fast. If the repo is not yet cached you will see cloning progress on stderr.

Use this when:

- A user asks about a library, framework, or tool you don't have full source knowledge of
- You need to verify exact function signatures, types, or behavior
- You need to trace how something is implemented rather than guessing from docs
