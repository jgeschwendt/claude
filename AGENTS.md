# claude

```stele
kind: system
purpose: Claude Code harness — global config, rules, skills and the subether mod; `mise run link` symlinks each rule, skill, workflow and user file into ~/.claude.
commands:
  lint: bun --bun oxlint
  test: bun run test
invariants:
  - claim: link never overwrites — items link one by one into real ~/.claude/rules, skills and workflows directories (user files at the top); an item path that is a real file or directory or a foreign link is reported `drift` and left alone; only a missing item is linked, and only a link already into this checkout is re-pointed
    anchor: ※ link-never-overwrites
```

## Map

| where           | what                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| .claude-plugin/ | `marketplace.json`: the repo as the local marketplace `jgeschwendt`, listing `plugins/subether` and `skills/monitor` (the /afk broadcast)                                                              |
| .mise/tasks/    | `doctor.ts` (`mise run doctor`: a read-only health check of the live setup — parse, link, install, version, MCP servers, plugins, skills, always-loaded memory, hook latency — one `ok:`/`broken:`/`unused:`/`note:` line per finding, exit 1 on any broken; the weekly routine runs it), `link` (symlink each rule, skill and workflow into a real `~/.claude/<dir>/`, each user file into `~/.claude/`; `--check` only reports), each with its end-to-end `*.test.ts` against a scratch home |
| docs/           | `index.html`: the harness design page and the plan (`ol#next`); `subether.html`: the mod's design page, its hook graph fed by `data/hooks.json`                                                         |
| plugins/        | Claude Code mods — `subether` (first-prompt recall and pane, guards, tool and prompt log, gauge and window clock); its README and `tests/` (`claude plugin test`)                     |
| scripts/        | `test.ts`, the gate `mise run check` runs: every step at once — fmt, lint, tsc, the unit tests (`*.test.ts` under `.mise/tasks` and `skills`), the mod's validate and tests; validate is not `--strict`; the mod's own tsc and its senses survey run only where a session has loaded the mod (the engine writes its types), so not in CI, whose `claude` is pinned in `ci.yaml` and moves with the events the mod registers |
| rules/          | house standards, one file per language or practice, each linked into `~/.claude/rules/` |
| skills/         | personal skills, each directory linked into `~/.claude/skills/`; a git-ignored one is not linked |
| user/           | what `~/.claude` reads at the user level, each file linked under its basename: `CLAUDE.md`, the owner's user memory (the root `CLAUDE.md` is this project's, one line importing this file), and `settings.json` |
| workflows/      | saved dynamic workflows, each linked into `~/.claude/workflows/`; `meta.name` is the `/command`, every `agent()` pins `model: 'opus'` |

## Working here

- `main` carries one commit a day, subject exactly `sync: MM/DD/YY`, amended as the day goes and published with a lease on the commit it replaces, `git push --force-with-lease=main:<published sha> origin main` (the only force-push subether's guard passes; the owner's account bypasses the `main` ruleset); other branches name commits freely and fold into the day's sync when they land. hk's `commit-msg` hook rejects any other subject on `main`; `hk install --mise` once per clone arms it, with `bun install` for the pre-commit steps.
- Work happens in the `main` checkout itself: no worktree, no feature branch, for a session or for an agent it dispatches. (since 2026-11-19 · "keep everything in main here, no worktrees are needed for this project")
- The marketplace is installed once per machine: `claude plugin marketplace add ~/.grove/code/jgeschwendt/claude/main`, then `claude plugin install subether@jgeschwendt` (at cutover; until then the live `settings.json` loads `main/plugins/subether` through `env.CLAUDE_CODE_PLUGIN_DIRS`). A relative-path plugin of a local-path marketplace loads in place (Claude Code 2.1.318 docs), so a change is live at the next session or `/reload-plugins` with no `version` bump — verify `installPath` at cutover; `claude plugin validate plugins/subether --strict` and `claude plugin test plugins/subether` check it.
- A new rule, skill, workflow or user file reaches `~/.claude` only after `mise run link`.
- Runtime but load-bearing, in `~/.claude` rather than the repo: `plans/` is what `/execute-plan` runs (newest file wins); `briefs/` holds write-ups that brief a future session, never executed; `research/` holds the `/gigaresearch` workspaces, one directory per question, resumed by slug.

<!-- @stele -->

## Hazards (0 active)


## Map

| node | kind      | purpose                                                                                                                                                                            | unfold                                         |
| ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| docs | container | index.html, the harness design page; subether.html, the mod's: four figures, three d3 charts (hook graph, atoms, call machine); the live data views are bifrost's /system/portals. | `stele unfold docs` · or read `docs/AGENTS.md` |

## Indexes

All invariants: `.stele/index/invariants.md` · all hazards: `.stele/index/hazards.md`

## Engine

`stele` CLI available → `stele root | unfold <id> | invariants --touching <path> | hazards | nodes --kind <k>`. MCP: `stele serve`.
No engine → everything above is complete; nested AGENTS.md files carry the detail (nearest file wins).
<!-- @end -->
