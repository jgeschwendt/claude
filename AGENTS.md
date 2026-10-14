# claude

```stele
kind: system
purpose: Claude Code harness — global config, rules and skills, plus the Rust statusline; `mise run link` symlinks each entry into ~/.claude.
commands:
  lint: cargo clippy --all-targets -- -D warnings
  test: cargo test
invariants:
  - claim: link never overwrites — an entry in ~/.claude that is a real file or a foreign link is reported `drift` and left alone; only missing entries are linked
    anchor: ※ link-never-overwrites
```

## Map

| where | what |
| --- | --- |
| .mise/tasks/ | `link` (symlink entries into `~/.claude`; `--check` only reports) and `save` (commit today's `sync:` and push main) |
| rules/ | house standards, one file per language or practice, read through `~/.claude/rules` |
| skills/ | personal skills, read through `~/.claude/skills`; `skills/synced/` is Claude Code's, gitignored |
| src/ | `claude-home` crate — `lib.rs` modules `log`, `statusline`; `src/bin/` holds thin `main`s over them |
| tests/ | end-to-end tests driving the built `statusline` binary against a temp `$HOME` |

## Working here

- `settings.json` points the statusline at `~/.claude/target/release/statusline` — a source change is live only after `cargo build --release`.

<!-- @stele -->

## Hazards (0 active)


## Map

| node | kind | purpose | unfold |
| ---- | ---- | ------- | ------ |

## Indexes

All invariants: `.stele/index/invariants.md` · all hazards: `.stele/index/hazards.md`

## Engine

`stele` CLI available → `stele root | unfold <id> | invariants --touching <path> | hazards | nodes --kind <k>`. MCP: `stele serve`.
No engine → everything above is complete; nested AGENTS.md files carry the detail (nearest file wins).
<!-- @end -->
