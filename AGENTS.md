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
| docs/           | `index.html`: the design page and the plan (`ol#next`)                                                                                                                                                 |
| plugins/        | Claude Code mods — `subether` (session hooks, guards, gauge row and window clock, shift band); its README and `*.test.ts` (`claude plugin test`)                                                       |
| scripts/        | `test.ts`, the gate `mise run check` runs: every step at once — fmt, lint, tsc, the unit tests (`*.test.ts` under `.mise/tasks` and `skills`), monitor-github's selftest, the mod's validate and tests |
| rules/          | house standards, one file per language or practice, read through `~/.claude/rules`                                                                                                                     |
| skills/         | personal skills, read through `~/.claude/skills`; `skills/synced/` is Claude Code's, gitignored                                                                                                        |

## Working here

- The marketplace is installed once per machine: `claude plugin marketplace add ~/.grove/code/jgeschwendt/claude/main`, then `claude plugin install perpetual@jgeschwendt`. A mod change bumps its `plugin.json` `version` and is live after `claude plugin update perpetual@jgeschwendt` on a pulled trunk; `claude plugin validate plugins/perpetual --strict` and `claude plugin test plugins/perpetual` check it.
- Runtime but load-bearing, in `~/.claude` rather than the repo: `plans/` is what `/execute-plan` runs (newest file wins); `briefs/` holds write-ups that brief a future session, never executed.

<!-- @stele -->

## Hazards (0 active)


## Map

| node | kind      | purpose                                                                                                                                 | unfold                                         |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| docs | container | index.html — the design page: link, the perpetual mod, the subether gauge and window clock, the gate, and the plan (ol#next), in order. | `stele unfold docs` · or read `docs/AGENTS.md` |

## Indexes

All invariants: `.stele/index/invariants.md` · all hazards: `.stele/index/hazards.md`

## Engine

`stele` CLI available → `stele root | unfold <id> | invariants --touching <path> | hazards | nodes --kind <k>`. MCP: `stele serve`.
No engine → everything above is complete; nested AGENTS.md files carry the detail (nearest file wins).
<!-- @end -->
