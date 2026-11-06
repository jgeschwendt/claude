# claude

```stele
kind: system
purpose: Claude Code harness — global config, rules, skills and the subether mod; `mise run link` symlinks each entry into ~/.claude.
commands:
  lint: bun --bun oxlint
  test: bun run test
invariants:
  - claim: link never overwrites — an entry in ~/.claude that is a real file or a foreign link is reported `drift` and left alone; only missing entries are linked
    anchor: ※ link-never-overwrites
```

## Map

| where           | what                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| .claude-plugin/ | `marketplace.json`: the repo as the local marketplace `jgeschwendt`, listing `plugins/subether` and `skills/monitor` (the /afk broadcast)                                                              |
| .mise/tasks/    | `link` (symlink entries into `~/.claude`; `--check` only reports) and `link.test.ts`, its end-to-end test against a scratch home                                                                       |
| docs/           | `index.html`: the harness design page and the plan (`ol#next`); `subether.html`: the mod's design page, its hook graph fed by `data/hooks.json`                                                         |
| plugins/        | Claude Code mods — `subether` (first-prompt recall and pane, guards, tool log, judged markers, shadow check, gauge and window clock); its README and `tests/` (`claude plugin test`)                     |
| scripts/        | `test.ts`, the gate `mise run check` runs: every step at once — fmt, lint, tsc, the unit tests (`*.test.ts` under `.mise/tasks` and `skills`), monitor-github's selftest, the mod's validate and tests |
| rules/          | house standards, one file per language or practice, read through `~/.claude/rules`                                                                                                                     |
| skills/         | personal skills, read through `~/.claude/skills`; `skills/synced/` is Claude Code's, gitignored                                                                                                        |

## Working here

- The marketplace is installed once per machine: `claude plugin marketplace add ~/.grove/code/jgeschwendt/claude/main`, then `claude plugin install subether@jgeschwendt` (at cutover; until then the live `settings.json` loads the `perpetual/rewrite` worktree's `plugins/subether` through `env.CLAUDE_CODE_PLUGIN_DIRS`). A relative-path plugin of a local-path marketplace loads in place (Claude Code 2.1.318 docs), so a change is live at the next session or `/reload-plugins` with no `version` bump — verify `installPath` at cutover; `claude plugin validate plugins/subether --strict` and `claude plugin test plugins/subether` check it. `mise run link`'s mod check still reads `plugins/perpetual` and is broken on this branch until cutover.
- Runtime but load-bearing, in `~/.claude` rather than the repo: `plans/` is what `/execute-plan` runs (newest file wins); `briefs/` holds write-ups that brief a future session, never executed.

<!-- @stele -->

## Hazards (0 active)


## Map

| node | kind      | purpose                                                                                                                                                                       | unfold                                         |
| ---- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| docs | container | index.html — the harness design page: link, a subether paragraph, the gate, the plan (ol#next); subether.html — the mod's design page, its hook graph fed by data/hooks.json. | `stele unfold docs` · or read `docs/AGENTS.md` |

## Indexes

All invariants: `.stele/index/invariants.md` · all hazards: `.stele/index/hazards.md`

## Engine

`stele` CLI available → `stele root | unfold <id> | invariants --touching <path> | hazards | nodes --kind <k>`. MCP: `stele serve`.
No engine → everything above is complete; nested AGENTS.md files carry the detail (nearest file wins).
<!-- @end -->
