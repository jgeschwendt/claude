# claude

What shapes a Claude Code session is tracked and synced; what sessions accrete stays out.
The repo is the grove root `jgeschwendt/claude`, checked out at `~/.grove/code/jgeschwendt/claude/main`.
`~/.claude` is not a repo: it holds Claude Code's runtime state plus a symlink into this checkout for
each entry read through it — `CLAUDE.md`, `rules/`, `settings*.json`, `skills/`, `target/`. `mise run link` re-links (`--check` only reports); a `drift:` line means a writer replaced
a link with a real file — merge it into the checkout by hand, then re-link.

## Tracked

<!-- curated, not exhaustive -->

```
jgeschwendt/claude
├── .mise/tasks/           link and save — `mise tasks` describes them
├── rules/                 house standards for code and docs
├── skills/                personal skills, lean and self-contained
├── src/                   claude-home crate: format (PostToolUse hook), statusline, log
├── tests/                 integration tests that drive the built binaries
├── Cargo.toml             the crate manifest
├── CLAUDE.md              global instructions: golden rule, house rules, memory contract
├── mise.toml              toolchain pins (rust, bun) and the build/test tasks
├── settings.json          harness config — hook wiring, permissions
└── settings.local.json    output-style override
```

Runtime but load-bearing, in `~/.claude` rather than the repo: `plans/` is what `/execute-plan` runs (newest file wins); `briefs/` holds write-ups meant to brief a future session, never executed.

## The crate

`format` and `statusline` are Rust binaries; `settings.json` wires the harness straight at
`~/.claude/target/release/<name>`, so a source change is live only once it is rebuilt.

`mise.toml` pins the toolchain (rust, bun) and this repo's own oxfmt/oxlint (npm backend), and carries the tasks:

```sh
mise install            # rust, bun, and the pinned oxfmt/oxlint the format hook runs on this repo
mise run build          # cargo build --release → target/release/{format,statusline}
mise run test           # cargo test: unit tests in src/, end-to-end tests in tests/
```

Both binaries append to `logs/<name>.log` (gitignored), capped at the last 50 lines.

The format hook runs the _project's own_ formatters over the file just edited: `oxlint --fix` then
`oxfmt`, each only when its config is on the walk-up path **and** the project pins the binary —
the nearest `node_modules/.bin/`, else a `mise.toml` pin (`mise which` from the file's directory).
No global fallback. A Prettier config anywhere on that path opts the project out entirely — such a
project is assumed to run Prettier through its own tooling.
