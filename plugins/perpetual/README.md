# perpetual

A Claude Code mod that puts the sandman shift in front of the session and trails the person's corrections. It observes and displays only: no hook blocks, rewrites or approves anything.

## Behaviour

- **Band above the prompt** — one dim line, cut to the band's width:
  `⟳ <shift> · <theme> · <repo> · <time to handoff> · last: <kind> <rationale>`.
  Read every 15 s from `~/.sandman/shifts/current.json` (`shift`, `theme`, `repo`, `handoff_by`) and the last line of
  today's (UTC) trail file `~/.sandman/trail/<yyyy>/<mm>/<dd>.jsonl`. Either may be missing; with neither, the band is left to
  the engine. Interactive sessions only.
- **Correction capture** — a prompt the person typed (or the driver's prompt under `claude -p`) that matches `^no[,.! ]`,
  `don't`/`dont`, `never`, `stop`, `i said`, `wrong` or `not what i` (case-insensitive) runs
  `sandman trail append --kind correction --rationale <first 200 chars> --ref session:<id>`, plus `--shift $SANDMAN_SHIFT`
  when set. A prompt of three or more tokens whose token set has Jaccard ≥ 0.8 with an earlier prompt of the session is
  appended instead with the rationale `repeated instruction: …`. A failed append is a dim transcript line; the prompt
  always continues unchanged.
- **`/shift`** runs `sandman shift status` (unverified 2026-10-09 · sandman has no `shift` verb yet); **`/trail [n]`** runs `sandman trail log` and keeps its last `n` lines (10 by
  default) — `trail log` takes no count (verified 2026-10-09 · sandman `src/cli.rs`). Output is a `$.ui.log` line Claude never reads; both run mid-turn.

## Running it

```sh
claude --plugin-dir <checkout>/plugins/perpetual
```

or, where no flag can be given, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` (process environment or the `env` block of
`~/.claude/settings.json`). An interactive session hot-reloads the folder on save. (verified 2026-10-09 · Claude Code 2.1.296 plugin-authoring reference; `-p` load probed)

## Checking it

```sh
claude plugin validate plugins/perpetual --strict
claude plugin test plugins/perpetual
```
