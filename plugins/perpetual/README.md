# perpetual

The harness's Claude Code mod: it runs the session hooks that `settings.json` used to wire, guards tool calls against the house rules, keeps the five-hour window clock, logs corrections to the trail, and puts the sandman shift above the prompt.

## Behaviour

- **Session hooks** — each binary runs from `$HOME/.local/bin` through `$.process.run`; a `--hook` call gets the settings hook's stdin JSON (the `classic.<Event>` event's `e`) on stdin, and its output is read as a command hook's: a JSON reply adds its `hookSpecificOutput.additionalContext` or nothing, other stdout adds itself. A missing binary, a timeout or a non-zero exit is a dim `$.ui.log` line and adds nothing; no exit code blocks.

  | event                                                                            | runs                                                                                                                                                                                                  | returns                                                                           |
  | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
  | `classic.SessionStart`                                                           | `sandman recall --hook`, `docket --hook`, `sandman report --hook`, 10 s each, and the dead-session sweep (`docket list --json`, then a `docket resolve` per stale thread, 5 s each), concurrently     | the chain's result plus each one's context, in that order, as `additionalContext` |
  | `classic.UserPromptSubmit`                                                       | `docket --hook`, 10 s                                                                                                                                                                                 | docket's pull as `additionalContext`                                              |
  | `classic.Stop`                                                                   | `docket --hook`, 10 s                                                                                                                                                                                 | the chain's result untouched                                                      |
  | `classic.Notification` (`agent_needs_input`, `idle_prompt`, `permission_prompt`) | `docket --hook`, 10 s                                                                                                                                                                                 | the chain's result untouched                                                      |
  | `classic.SessionEnd`                                                             | `sandman take --hook`, 1.5 s — the SessionEnd budget — and concurrently `docket list --json`, then `docket resolve <id> --reason "session ended"` per notification thread of the session, 0.75 s each | the chain's result untouched                                                      |

  The SessionEnd resolve closes the session's notification `problem` — its title the first line of its first message, trimmed and cut at 120 characters, as docket's Notification derives it, and no line of any message a Stop's `failed:` or `needs input:` directive (later notifications append to it) — by id: an `idle_prompt` fires after the turn's last `Stop`, so docket's own close on `Stop` never reaches it, and `docket --hook` ignores SessionEnd (verified 2026-10-19 · docket `src/verbs/hook.rs`, probe under `$DOCKET_ROOT`). A `--key` resolve would also close the `failed:` `problem` (body the whole message) and `needs input:` `decision` docket's Stop opens under the same `session:<id>` key, a second after it opened them — every `claude -p` run ends in SessionEnd — so those are left for the owner. A killed session fires no SessionEnd, so the SessionStart sweep closes what such sessions left: it reads the live session ids from `~/.claude/sessions/<pid>.json` (`sessionId`; the `<pid>.<hash>.key` files beside them are skipped), runs `docket list --json`, and `docket resolve <id> --reason "session gone"` for every notification-born `problem` thread (its title the first line of its first message, trimmed and cut at 120 characters, as docket's Notification derives it, and no line of any message a Stop's `failed:` or `needs input:` directive (later notifications append to it)) keyed `session:<id>` whose id is not live, adding no context. A headless `claude -p` session never registers, so a `problem` docket's Stop opened for one on a `failed:` message (its body the whole message, not the title) is never swept. An unreadable registry, or one not listing this session, skips the sweep: the format changed and absence is no evidence (verified 2026-10-19 · Claude Code 2.1.304, `~/.claude/sessions/<pid>.json` observed).

  A `classic.*` hook's result carries `additionalContext` on SessionStart, UserPromptSubmit and Stop, not on Notification or SessionEnd (verified 2026-10-14 · Claude Code 2.1.296 `ClassicResultFields`). Under managed settings an installed mod's `classic.*` hooks do not run (verified 2026-10-14 · `claude plugin validate`).

- **Guards** — a Bash `pkill -f`/`--full`; a tree discard — `git checkout` with `--`, `.`, `-f`/`--force`, `--ours`/`--theirs`, `--pathspec-from-file` or a `<rev> <path>` pair, `git switch -f`/`--force`/`--discard-changes`, `git restore` unless `--staged`/`-S` without `--worktree`/`-W`, `git read-tree -u`/`--reset`, and an inline `alias.…`/`include.…`/`includeIf.…` (`git -c`, `--config-env`, `GIT_CONFIG_KEY_<n>=`, any case), which can hide any of them; `git reset --hard` (to `--ha`); `git push --force` (to `--forc`)/`-f` (bundled too)/`--force-with-lease` (to `--force-w`)/`+<refspec>`; `git stash` (not `list`/`show`); `git clean` (not `-n`/`--dry-run`) — and a `Write`/`Edit` to a `*.yml` path are denied with the house rule as the reason, each denial trailed: `sandman trail append --kind guard`. `-h`/`--help` after any git subcommand passes. The guard tokenizes the command as Bash would: quotes and escapes removed (`$'…'` decoded), each `$(…)`, backtick, `<(…)`, `sh -c`/`bash -lc`/`eval` string, unquoted heredoc's groups and `find -exec`/`-ok` command checked as a command of its own, redirections and `#` comments dropped, quoted heredoc bodies skipped. Each command's argv is read past `VAR=value` words, keywords (`if`, `then`, `do`, `!`, `{`, `function f`, `coproc`, …) and wrappers with their options (`sudo -u me`, `env -i`, `nice -n 5`, `timeout -s KILL 5`, `xargs -I{}`, `mise x node@22 --`, `script -q <file>`, `time`, `watch`, `stdbuf`, `caffeinate`, `parallel`, …), the command matched by basename. Not seen: a saved alias, variable indirection (`G=git; $G …`), arguments fed from a pipe (`… | xargs git`), `env -S`, and package runners (`npx`, `bunx`). An `agent.spawn` with no `model` (forks aside) is pinned to `opus`.
- **Window clock** — at `session.start` and on every `session.measure`, a `five_hour` entry of `$.session.usage().rateLimits` is piped, as a statusline payload (`rate_limits.five_hour.resets_at` in unix seconds, `used_percentage`, `session_id`, and a blank `model` so a statusline built before `--window` still parses it), to `statusline --window`, 5 s — the one writer of `window.json`, read by `sandman shift clock`; its rule and lock are `persist_window`'s in `src/statusline.rs`, summarized on the docs page (`docs/index.html#statusline`). Without the entry nothing runs; its exit 1 (an out-of-range percentage, a bad payload, an I/O failure) is the dim log line every binary gets. It needs `mise run build`'s `~/.local/bin/statusline`.
- **Band above the prompt** — one dim line, cut to the band's width:
  `⟳ <shift> · <theme> · <repo> · <time to handoff> · last: <kind> <rationale>`.
  Read every 15 s from `~/.sandman/shifts/current.json` (`shift`, `theme`, `repo`, `handoff_by`) and the last line of
  today's (UTC) trail file `~/.sandman/trail/<yyyy>/<mm>/<dd>.jsonl`. Either may be missing; with neither, or while a survey shows, the band is left to
  the engine. Interactive sessions only.
- **Correction capture** — a prompt the person typed at the composer (never a `claude -p`, plugin or notification prompt) that matches `^no(?:[,.!\s]|$)`,
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

The install enables it under `enabledPlugins` in the user `settings.json` — this repo's, through the `~/.claude` link — so every session loads it, `claude --bg` shifts included. The install is a versioned copy, not the trunk: `installed_plugins.json` pins `installPath` to `~/.claude/plugins/cache/jgeschwendt/perpetual/<version>`, taken at install, so a trunk edit is not live until it ships — each change bumps `version` in `.claude-plugin/plugin.json`, and goes live after `claude plugin update perpetual@jgeschwendt` on a pulled trunk (verified 2026-10-19 · the 0.2.0 copy from a97f0ee lacked later fixes).

## Checking it

```sh
claude plugin validate plugins/perpetual --strict
claude plugin test plugins/perpetual
```

The tests stub `$.process.run` beneath the mod, so no binary runs; `HOME` is stubbed to `/home/test`.
