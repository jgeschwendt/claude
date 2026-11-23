---
name: drive-sessions
description: Drive the background-sessions list (`claude agents`) through a held pty — read it, remove finished sessions, rename them — from a session that has only a shell. Use on "open a pty to work with these", "end/close/remove that session", "clean up the completed sessions", "which sessions can be closed", "rename the sessions", or a screenshot of the sessions list with an ask about its rows.
argument-hint: '[what to do with which sessions]'
---

# /drive-sessions

$ARGUMENTS

The sessions list is a TUI; `pty.ts` holds it in a pty and types for you.

```sh
P="bun ${CLAUDE_SKILL_DIR}/pty.ts"
$P open                      # claude agents, 200×50, detached; prints the socket
$P screen                    # the list as text
$P select <name-prefix>      # move the cursor to a row
$P remove <name-prefix>      # ctrl+x twice inside the confirm window, verified gone
$P rename <name-prefix> <new>  # ctrl+r, clear the prefilled field, type, verify, enter
$P send '\x1b[B'             # raw keys, for anything else; `?` in the list shows its shortcuts
$P close
```

Rows match by name prefix, first match wins: the list truncates long names with `…`, so give a prefix only one row has. New sessions dispatched from the held list start in the directory `open` ran in. Close the holder when the ask is done. (verified 2026-11-22 · open, screen, select, rename and close against the live list on Claude Code 2.1.330; remove by hand that day and in `pty.test.ts`)

## Facts, not the screen

The screen is for acting; decide from the records.

- `claude agents --json --all`: every session's `id`, `name`, `state`. Check it after each change.
- `~/.claude/jobs/<id>/state.json`: `intent` (first prompt), `template` and `respawnFlags` (how it was launched), `nameSource`, `output.result`, `needs`, `inFlight`, `children` (its PRs), `resumeSessionId`.
- `~/.claude/projects/*/<resumeSessionId>.jsonl`: the transcript; its user turns are the arc of the work.

## Whose session

- **An agent's**: `template: bg` with a one-line probe or test `intent` and no `originCwd`. Removable once `state` is `done` or `stopped`.
- **His**: `template: claude`, or `interactiveLineage: true` whatever the template. His to end, by name or by a list he approves.

## Can it be closed

Report three groups; remove only on his word.

- **Safe**: `done`, nothing in flight but its own monitor, and the claim in `output.result` verified where it lives — every PR in `children` merged (`gh pr view`), every named commit on the remote (`git branch -r --contains`), the tree clean.
- **His call**: finished but still holding something — an armed watch, a server it started, unpushed commits.
- **Keep**: `working` or `blocked`, a non-empty `needs`, an open PR, uncommitted work it is waiting on him to land.

Removing takes a session off the list and keeps its transcript.

## Renaming

Name the work, not the first prompt: read the transcript's user turns, since sessions drift (a "gmail mcp connection" became ingress filters). Kebab-case, the project first. Leave a name he set himself (`nameSource: user`) and any name already accurate; say which were left and which names rest on thin evidence.
