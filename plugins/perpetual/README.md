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

  The SessionEnd resolve closes the session's notification `problem` — its first message equal to its title, as docket's Notification opens one, and no message a Stop's `failed:` or `needs input:` (later notifications append to it) — by id: an `idle_prompt` fires after the turn's last `Stop`, so docket's own close on `Stop` never reaches it, and `docket --hook` ignores SessionEnd (verified 2026-10-19 · docket `src/verbs/hook.rs`, probe under `$DOCKET_ROOT`). A `--key` resolve would also close the `failed:` `problem` (body the whole message) and `needs input:` `decision` docket's Stop opens under the same `session:<id>` key, a second after it opened them — every `claude -p` run ends in SessionEnd — so those are left for the owner. A killed session fires no SessionEnd, so the SessionStart sweep closes what such sessions left: it reads the live session ids from `~/.claude/sessions/<pid>.json` (`sessionId`; the `<pid>.<hash>.key` files beside them are skipped), runs `docket list --json`, and `docket resolve <id> --reason "session gone"` for every notification-born `problem` thread (its first message equal to its title, as docket's Notification opens one, and no message a Stop's `failed:` or `needs input:` (later notifications append to it)) keyed `session:<id>` whose id is not live, adding no context. A headless `claude -p` session never registers, so a `problem` docket's Stop opened for one on a `failed:` message (its body the whole message, not the title) is never swept. An unreadable registry, or one not listing this session, skips the sweep: the format changed and absence is no evidence (verified 2026-10-19 · Claude Code 2.1.304, `~/.claude/sessions/<pid>.json` observed).

  A `classic.*` hook's result carries `additionalContext` on SessionStart, UserPromptSubmit and Stop, not on Notification or SessionEnd (verified 2026-10-14 · Claude Code 2.1.296 `ClassicResultFields`). Under managed settings an installed mod's `classic.*` hooks do not run (verified 2026-10-14 · `claude plugin validate`).

- **Guards** — a Bash `pkill -f`/`--full`, tree discard — `git checkout … --`/`.`/`-f`/`--force`/`--pathspec-from-file`, `git switch -f`/`--force`/`--discard-changes`, `git restore` (not `-h`/`--help`) unless `--staged`/`-S` without `--worktree`/`-W`, `git read-tree -u`/`--reset`, and a `git -c`/`--config-env` setting `alias.…` or `include.…`/`includeIf.…` (any case, harmless aliases too), which can hide any guarded command; config set through `GIT_CONFIG_*` variables or a saved alias is not seen — `git reset --hard` (abbreviated to `--ha`), `git push --force` (to `--forc`)/`-f` (bundled too: `-fu`)/`--force-with-lease` (to `--force-w`)/`+<refspec>`, each quoted or not, `git stash` (not `list`/`show`/`-h`/`--help`) or `git clean` (not with `-n`/`--dry-run`) at a command position, and a `Write`/`Edit` to a `*.yml` path, are denied with the house rule as the reason, and each denial is trailed: `sandman trail append --kind guard`. Backslash-newline continuations are joined first. A command position is a line start or follows `;`, `&`, `|`, `(`, `{`, `$(` or an `-exec`/`-execdir`/`-ok`/`-okdir` word (`find`'s, though any command's counts), past any `VAR=value`, keyword (`if`/`elif`/`while`/`until`/`then`/`do`/`else`/`!`) or wrapper (`builtin`, `command`, `doas`, `env`, `eval`, `exec`, `mise x`/`exec`, `nice`, `nohup`, `sh`/`bash`/`zsh`/`dash`/`ksh`, `sudo`, `time`, `timeout`, `xargs`), a wrapper's options (`-u me`, `-c '…'`; `--` takes no value), `tool@version` words (`mise x node@22 --`) and bare numbers (`timeout 5`) included; the command word may be quoted, `\`-escaped or path-qualified (`"git"`, `\git`, `/usr/bin/git`); git's global options (`-C <path>`, quoted or not, `-c`, `-P`, `--git-dir <dir>`) may stand before the subcommand, and a flag counts only before the command's next `;`, `&`, `|` or line end. The match is textual: a forbidden command quoted after any of those separators inside an argument is denied too. An `agent.spawn` with no `model` (forks aside) is pinned to `opus`.
- **Window clock** — at `session.start` and on every `session.measure`, the `five_hour` entry of `$.session.usage().rateLimits` is written to `$CLAUDE_WINDOW_FILE`, else `$XDG_STATE_HOME/claude/window.json`, else `~/.local/state/claude/window.json`, as `{"at","five_hour":{"resets_at","used_percentage"},"session_id"}`, `resets_at` in unix seconds — the statusline's format, read by `sandman shift clock`. `$.fs.write` is not atomic, so the file goes to `window.json.<session>.tmp` and `/bin/mv -f` renames it; a failed write or `mv` is a `$.ui.log` line. No write without both figures, with a percentage outside 0–100, or when the stored window is live (resets within 6 h) and ahead — a later `resets_at`, or the same with a higher `used_percentage` — the statusline's rule, so a reload's `session.start` in an idle session never rolls the clock back. The statusline's directory lock is beyond the mod API, so a write racing it can still land. (verified 2026-10-14 · code.claude.com/docs/en/plugins/mods/reference, Mods API methods)
- **Band above the prompt** — one dim line, cut to the band's width:
  `⟳ <shift> · <theme> · <repo> · <time to handoff> · last: <kind> <rationale>`.
  Read every 15 s from `~/.sandman/shifts/current.json` (`shift`, `theme`, `repo`, `handoff_by`) and the last line of
  today's (UTC) trail file `~/.sandman/trail/<yyyy>/<mm>/<dd>.jsonl`. Either may be missing; with neither, or while a survey shows, the band is left to
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

The install enables it under `enabledPlugins` in the user `settings.json` — this repo's, through the `~/.claude` link — so every session loads it, `claude --bg` shifts included. The install is a versioned copy, not the trunk: `installed_plugins.json` pins `installPath` to `~/.claude/plugins/cache/jgeschwendt/perpetual/<version>`, taken at install, so a trunk edit is not live until it ships — each change bumps `version` in `.claude-plugin/plugin.json`, and goes live after `claude plugin update perpetual@jgeschwendt` on a pulled trunk (verified 2026-10-19 · the 0.2.0 copy from a97f0ee lacked later fixes).

## Checking it

```sh
claude plugin validate plugins/perpetual --strict
claude plugin test plugins/perpetual
```

The tests stub `$.process.run` beneath the mod, so no binary runs; `HOME` is stubbed to `/home/test`.
