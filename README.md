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
├── src/                   claude-home crate: statusline, log
├── tests/                 integration tests that drive the built binaries
├── Cargo.toml             the crate manifest
├── CLAUDE.md              global instructions: golden rule, house rules, memory contract
├── mise.toml              toolchain pins (rust, bun) and the build/test tasks
├── settings.json          harness config — hook wiring, permissions
└── settings.local.json    output-style override
```

Runtime but load-bearing, in `~/.claude` rather than the repo: `plans/` is what `/execute-plan` runs (newest file wins); `briefs/` holds write-ups meant to brief a future session, never executed.

## The crate

`statusline` is a Rust binary; `settings.json` wires the harness straight at
`~/.claude/target/release/statusline`, so a source change is live only once it is rebuilt.

`mise.toml` pins the toolchain (rust, bun) and this repo's own oxfmt/oxlint (npm backend), and carries the tasks:

```sh
mise install            # rust, bun, and the pinned oxfmt/oxlint this repo formats with
mise run build          # cargo build --release → target/release/statusline
mise run test           # cargo test: unit tests in src/, end-to-end tests in tests/
```

`statusline` logs to `logs/statusline.log` (gitignored), overwriting it each tick with that tick's payload or error (plus any window-write failure).

Each statusline tick whose payload carries `rate_limits` also writes the five-hour window —
`{"at","five_hour":{"resets_at","used_percentage"},"session_id"}` — atomically to
`$XDG_STATE_HOME/claude/window.json` (default `~/.local/state/claude/window.json`; `$CLAUDE_WINDOW_FILE` overrides it).
The write is monotone: a window not resetting within 6h, or behind the stored live one (an earlier
`resets_at`, or less used of the same), writes nothing — an idle session never rolls the clock back.
