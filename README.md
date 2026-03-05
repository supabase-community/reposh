# repo-over-ssh

Browse any public GitHub repo over SSH using standard Unix tools. Designed for LLM consumption.

Commands run inside [just-bash](https://github.com/vercel-labs/just-bash) - a sandboxed in-memory shell - so it's safe to expose publicly. Repos are cloned on demand and cached.

## Usage

The SSH username encodes the repo: `org/repo` (assumes GitHub) or `host/org/repo` for other git hosts.

```bash
# List files
ssh supabase/supabase@repo.cat ls

# Search across the repo
ssh supabase/supabase@repo.cat "grep -r 'vector' src/"

# Read a file
ssh supabase/supabase@repo.cat cat README.md

# Pipe commands (always quote to prevent local shell expansion)
ssh supabase/supabase@repo.cat "find . -name '*.ts' | head -20"

# Interactive shell
ssh supabase/supabase@repo.cat

# Explicit git host (GitLab, etc.)
ssh gitlab.com/some-org/some-repo@repo.cat ls
```

## Setup

```bash
pnpm install
pnpm dev
```

The server listens on port 22 by default. A host key is generated on first run and saved to `keys/host_key`.

### Docker

```bash
docker compose up
```

Cloned repos are persisted in a named volume (`repo-cache`) across restarts.

## Configuration

| Env var         | Default           | Description                     |
| --------------- | ----------------- | ------------------------------- |
| `PORT`          | `22`              | SSH server port                 |
| `HOST_KEY_PATH` | `./host_key`      | Path to RSA host key            |
| `CACHE_DIR`     | `~/.cache/repocat`       | Where clones are stored    |
| `CACHE_TTL_MS`  | `300000` (5 min)  | How long before pulling updates |

## Caching

On first access a shallow clone (`depth=1`) is created under `CACHE_DIR/<host>/<org>/<repo>/`. Subsequent requests within the TTL are served from cache. After the TTL, a `git pull` runs in the background and the current session is served stale. If pull fails (e.g. force-push), it falls back to a full re-clone.

## Aliases

| Alias | Expands to |
| ----- | ---------- |
| `ll`  | `ls -alF`  |
| `la`  | `ls -a`    |
| `l`   | `ls -CF`   |
