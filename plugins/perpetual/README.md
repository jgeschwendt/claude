# perpetual

The harness's Claude Code mod: it runs the session hooks that `settings.json` used to wire, guards tool calls against the house rules, keeps the five-hour window clock, and puts the sandman shift above the prompt.

## Behaviour

- **Session hooks** — each binary runs from `$HOME/.local/bin` through `$.process.run`, with the settings hook's stdin JSON (the `classic.<Event>` event's `e`) on stdin, and its output read as a command hook's: a JSON reply's `hookSpecificOutput.additionalContext`, else plain stdout. A missing binary, a timeout or a non-zero exit is a dim `$.ui.log` line and adds nothing; no exit code blocks.

  | event                                                                            | runs                                                                                                                                     | returns                                                                           |
  | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
  | `classic.SessionStart`                                                           | `sandman recall --hook`, `docket --hook`, `sandman report --hook`, concurrently, 10 s each                                               | the chain's result plus each one's context, in that order, as `additionalContext` |
  | `classic.UserPromptSubmit`                                                       | `docket --hook`, 10 s                                                                                                                    | docket's pull as `additionalContext`                                              |
  | `classic.Stop`                                                                   | `docket --hook`, 10 s                                                                                                                    | the chain's result untouched                                                      |
  | `classic.Notification` (`permission_prompt`, `idle_prompt`, `agent_needs_input`) | `docket --hook`, 10 s                                                                                                                    | the chain's result untouched                                                      |
  | `classic.SessionEnd`                                                             | `sandman take --hook` and `docket resolve --key session:<id> --reason "session ended"`, concurrently, 1.5 s each — the SessionEnd budget | the chain's result untouched                                                      |

  The SessionEnd resolve closes the session's notification `problem`: an `idle_prompt` fires after the turn's last `Stop`, so docket's own close on `Stop` never reaches it, and `docket --hook` ignores SessionEnd (verified 2026-10-19 · docket `src/verbs/hook.rs`, probe under `$DOCKET_ROOT`).

  A `classic.*` hook's result carries `additionalContext` on SessionStart, UserPromptSubmit and Stop, not on Notification or SessionEnd (verified 2026-10-14 · Claude Code 2.1.296 `ClassicResultFields`). Under managed settings an installed mod's `classic.*` hooks do not run (verified 2026-10-14 · `claude plugin validate`).

- **Guards** — a Bash `pkill -f`/`--full`, `git checkout … --`, `git reset --hard`, `git push --force`/`-f` (bundled too: `-fu`)/`--force-with-lease`/`+<refspec>`, `git stash` (not `list`/`show`) or `git clean` at a command position, and a `Write`/`Edit` to a `*.yml` path, are denied with the house rule as the reason, and each denial is trailed: `sandman trail append --kind guard`. A command position is a line start or follows `;`, `&`, `|`, `(`, `{` or `$(`, past any `then`/`do`/`else`, wrapper (`sudo`, `env`, `command`, `exec`, `nohup`, `time`, `xargs`) or `VAR=value`; git's global options (`-C <path>`, quoted or not, `-c`, `-P`, `--git-dir <dir>`) may stand before the subcommand, and a flag counts only on the command's own line. The match is textual: a forbidden command quoted after `;`, `&`, `|` or `(` inside an argument is denied too. An `agent.spawn` with no `model` (forks aside) is pinned to `opus`.
- **Window clock** — at `session.start` and on every `session.measure`, the `five_hour` entry of `$.session.usage().rateLimits` is written to `$CLAUDE_WINDOW_FILE`, else `$XDG_STATE_HOME/claude/window.json`, else `~/.local/state/claude/window.json`, as `{"at","five_hour":{"resets_at","used_percentage"},"session_id"}`, `resets_at` in unix seconds — the statusline's format, read by `sandman shift clock`. `$.fs.write` is not atomic, so the file goes to `window.json.<session>.tmp` and `/bin/mv -f` renames it. No write without both figures. (verified 2026-10-14 · code.claude.com/docs/en/plugins/mods/reference, Mods API methods)
- **Band above the prompt** — one dim line, cut to the band's width:
  `⟳ <shift> · <theme> · <repo> · <time to handoff> · last: <kind> <rationale>`.
  Read every 15 s from `~/.sandman/shifts/current.json` (`shift`, `theme`, `repo`, `handoff_by`) and the last line of
  today's (UTC) trail file `~/.sandman/trail/<yyyy>/<mm>/<dd>.jsonl`. Either may be missing; with neither, the band is left to
  the engine. Interactive sessions only.
- **Correction capture** — a prompt the person typed at the composer (never a `claude -p`, plugin or notification prompt) that matches `^no[,.! ]`,
  `don't`/`dont`, `never`, `stop`, `i said`, `wrong` or `not what i` (case-insensitive) runs
  `sandman trail append --kind correction --rationale <first 200 chars> --ref session:<id>`, plus `--shift $SANDMAN_SHIFT`
  when set. A prompt of three or more tokens whose token set has Jaccard ≥ 0.8 with an earlier prompt of the session is
  appended instead with the rationale `repeated instruction: …`. Skipped, and kept out of the repeat comparison: a prompt
  over 400 characters, one starting `# ` (a shift or breath brief, a pasted document), and the opening prompt of a
  `claude --bg` session — dispatch's brief. That prompt reaches the mod as a composer prompt of an interactive `terminal`
  session; the one signal telling it apart is the daemon's `CLAUDE_CODE_SESSION_KIND=bg` (verified 2026-10-14 · Claude
  Code 2.1.299, probe mod under `--bg` and interactive). The prompt always continues unchanged.
- **`/shift`** runs `sandman shift status`, **`/docket`** `docket list`, **`/trail [n]`** `sandman trail log` cut to its last `n` lines (10 by
  default). Output is a `$.ui.log` line Claude never reads; all three run mid-turn.

## Installing it

The harness repo is a marketplace (`.claude-plugin/marketplace.json`); once per machine:

```sh
claude plugin marketplace add ~/.grove/code/jgeschwendt/claude/main
claude plugin install perpetual@jgeschwendt
```

The install enables it under `enabledPlugins` in the user `settings.json` — this repo's, through the `~/.claude` link — so every session loads it, `claude --bg` shifts included. A local marketplace is read in place: an edit on the trunk is live from the next session. (verified 2026-10-14 · code.claude.com/docs/en/plugin-marketplaces)

## Checking it

```sh
claude plugin validate plugins/perpetual --strict
claude plugin test plugins/perpetual
```

The tests stub `$.process.run` beneath the mod, so no binary runs; `HOME` is stubbed to `/home/test` and each test asserts the argv under `/home/test/.local/bin`.
