# claude

What shapes a Claude Code session is tracked and synced; what sessions accrete stays out.
The repo is the grove root `jgeschwendt/claude`, checked out at `~/.grove/code/jgeschwendt/claude/main`.
`~/.claude` is not a repo: it holds Claude Code's runtime state plus a symlink into this checkout for
each entry read through it — `CLAUDE.md`, `rules/`, `settings*.json`, `skills/`. `mise run link` re-links (`--check` only reports); a `drift:` line means a writer replaced
a link with a real file — merge it into the checkout by hand, then re-link.

## Tracked

<!-- curated, not exhaustive -->

```
jgeschwendt/claude
├── .claude-plugin/        marketplace.json — the repo as the local marketplace `jgeschwendt`
├── .mise/tasks/           link — `mise tasks` describes it
├── plugins/               Claude Code mods the marketplace lists
├── rules/                 house standards for code and docs
├── skills/                personal skills, lean and self-contained
├── src/                   claude-home crate: statusline, log
├── tests/                 integration tests that drive the built binaries
├── Cargo.toml             the crate manifest
├── CLAUDE.md              global instructions: golden rule, house rules, memory contract
├── mise.toml              toolchain pins (rust, bun) and the build/test tasks
├── settings.json          harness config — permissions, enabled plugins (the perpetual mod), statusline
└── settings.local.json    output-style override
```

Runtime but load-bearing, in `~/.claude` rather than the repo: `plans/` is what `/execute-plan` runs (newest file wins); `briefs/` holds write-ups meant to brief a future session, never executed.

## Mods

`plugins/perpetual` is the harness's mod, and `settings.json` wires no hooks of its own: the mod runs sandman's and docket's session hooks, denies the commands the house rules forbid, writes the five-hour window clock and draws the shift band; its README holds the detail. The repo is a local marketplace, installed once per machine:

```sh
claude plugin marketplace add ~/.grove/code/jgeschwendt/claude/main
claude plugin install perpetual@jgeschwendt
```

`settings.json` enables it (`enabledPlugins`). The install is a versioned copy under `~/.claude/plugins/cache/`, so a mod change bumps its `plugin.json` `version` and goes live after `claude plugin update perpetual@jgeschwendt` on a pulled trunk. `claude plugin validate plugins/perpetual --strict` and `claude plugin test plugins/perpetual` check it.

## The crate

`statusline` is a Rust binary; `settings.json` runs it from `~/.local/bin/statusline`, where `mise run build`
installs it. It lives outside `target/`, which mbx redirects into `~/Library/Caches/mbx/` and its gc prunes when the
disk is tight (that pruning blanked the status bar, 2026-10-17). A source change is live only once rebuilt.

`mise.toml` pins the toolchain (rust, bun) and this repo's own oxfmt/oxlint (npm backend), and carries the tasks:

```sh
mise install            # rust, bun, and the pinned oxfmt/oxlint this repo formats with
mise run build          # cargo build --release, then install → ~/.local/bin/statusline
mise run test           # cargo test: unit tests in src/, end-to-end tests in tests/
```

`statusline` logs to `logs/statusline.log` (gitignored), overwriting it each tick with that tick's payload or error (plus any window-write failure).

Each statusline tick whose payload carries `rate_limits` also writes the five-hour window —
`{"at","five_hour":{"resets_at","used_percentage"},"session_id"}` — atomically to
`$XDG_STATE_HOME/claude/window.json` (default `~/.local/state/claude/window.json`; `$CLAUDE_WINDOW_FILE` overrides it).
The write is monotone: a window not resetting within 6h, or behind the stored live one (an earlier
`resets_at`, or less used of the same), writes nothing — an idle session never rolls the clock back.
The perpetual mod writes the same file at `session.start` and on `session.measure`, without the monotone check.
