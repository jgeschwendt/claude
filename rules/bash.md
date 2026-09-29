---
paths:
  - "**/*.{bash,sh}"
---

# Bash

Comment syntax: see `rules/comments.md`. The globs can't catch extensionless scripts (the harness repo's `.mise/tasks/*`) — a bash shebang means these rules apply even when this file didn't auto-load.

## macOS 3.2 compatibility

Any script a `#!/bin/bash` or `sh` shebang runs inherits macOS's frozen 3.2 interpreter — use the 3.2-safe form. A repo that deliberately targets newer bash (`#!/usr/bin/env bash` plus its own convention) is exempt.

- **Never nest `case` inside `$( )` command substitution** — the 3.2 parser fails on the pattern's `)`; hoist into a function and call it inside the substitution. (since 2026-07-12 · monitor-github/scripts/monitor.sh)
- **Dispatch with parallel arrays or `case`, not associative arrays** (`declare -A`, 4.0+).
- **Read lines with `while IFS= read -r`, not `mapfile`/`readarray`** (4.0+).
- **Change case with `tr '[:upper:]' '[:lower:]'`, not `${var,,}`/`${var^^}`** (4.0+).
- **Recurse with `find`, not globstar** (`shopt -s globstar`, 4.0+).
- **Append with `>> file 2>&1`, not `&>>`** (4.0+).
- **Trim a trailing char with `${var%?}` or `${var:0:$((${#var}-1))}`, not `${var:0:-1}`** (negative substring length, 4.2+).
- **Wait on a specific PID, not `wait -n`** (4.3+).
- **Pass values and echo results, not namerefs** (`declare -n`, 4.3+).
- **Take time from `$(date +%s)`, not `$EPOCHSECONDS`/`$EPOCHREALTIME`** (5.0+) — these expand silently empty.

Why: macOS ships bash 3.2.57 as `/bin/bash` and never updates it. Every failure above re-probed against 3.2.57. (verified 2026-07-19)

## Locale

- **Pin `LC_ALL=C` in any script whose glob/`case` patterns use character ranges** — under a UTF-8 locale `[a-z]` collates to admit uppercase, so guards like `[!a-z0-9-]` silently pass `AGENTS`. (since 2026-08-15 · routines/bin/routine)

## Script conventions

Conventions the `~/.claude` scripts follow — match them in scripts authored for this machine; a foreign repo's own convention wins. (since 2026-07-19 · mined from `skills/*/scripts/*.sh` + `@routines/*.sh`)

- **Open every script with `set -u`; guard optional vars with `${var:-}`.** Query/pipeline scripts (daemons included) add `-e -o pipefail`; lifecycle/hook/test scripts that must survive partial failure stay `-u`-only. Under `-e`, every expected-failure command carries an explicit guard (`|| true`, `|| die_json …`) — unguarded errexit dies before your error contract can fire.
- **Pass data into jq with `--arg`/`--argjson` (or `gh api -f`/`-F`); the filter stays a single-quoted literal** — assembled only from literal pieces, never from runtime values, which break it on quotes, `$`, and newlines.
- **A JSON-stdout script fails as JSON** — `{"error":"…","hint":"…"}` on stderr, non-zero exit; plain-text scripts keep plain `echo … >&2; exit N`. Mixed scripts route progress to stderr so stdout stays one parseable payload.
- **Persist with `jq -c`; pretty-print only the final human/agent-facing stdout.** Multi-line JSON corrupts a JSONL append.
- **Resolve state dirs through an overridable env var** — `"${CLAUDE_HOME:-$HOME/.claude}"`, never a bare `~` in code; the indirection is what lets tests redirect.
- **Document positional params in a trailing comment on the opening-brace line:** `foo() { # $1=sid`.
