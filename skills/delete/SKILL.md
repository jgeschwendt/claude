---
name: delete
description: THE forget — wipe the current conversation outright, no pointer, no archive copy, no extraction, unrecoverable. Stops this session's background jobs, destroys the live transcript, its subagent files, anything already archived, and the short-term pointer, then closes the session and erases the exit flush. The privacy ending; every other ending is taken into the archive for dreaming. There is no softer delete — this verb is always the hard one. Triggers on "/delete", "delete this session", "hard delete this session", "erase this session".
---

# Delete → the conversation is erased

Every other ending is taken: the SessionEnd hook archives the transcript into
`~/.sandman/.archive/` and mints a pointer, and the dream pass extracts from it later.
This one leaves nothing — for material that should never have been written down.
The take ending has its own verb, `/dissolve` — end the conversation and keep it.

Run the steps **in order** — this is live work only a running session can do.

## 1. Stop background jobs — only the ones THIS session started

Do **not** `pkill` by name; other sessions run their own dev servers and tasks. Kill only
processes you launched this session, by their **specific PIDs**. If you started nothing,
say so and move on.

## 2. Erase the conversation

```
~/.local/bin/sandman forget "${CLAUDE_SESSION_ID:-$CLAUDE_CODE_SESSION_ID}"
```

It destroys every copy of this session — the live transcript, its subagent files,
anything `take` already archived under `~/.sandman/.archive/`, and the short-term
pointer — widest reach first, so an interrupted run leaves the conversation harder to
recover, never easier. Both id variables are read because only `CLAUDE_CODE_SESSION_ID`
is set in a background job (observed 2026-08-25). Bank memories are untouched: a memory already committed was
asked for. The exit flush regrows the transcript and the SessionEnd hook's `take --hook` archives it
with a pointer; step 3's watcher runs `forget` again once the CLI is gone.

## 3. End the session

**Interactive session:**

```
bash ~/.claude/skills/delete/scripts/delete-session.sh "$CLAUDE_SCRATCHPAD_DIR"
```

(Omit the argument if `$CLAUDE_SCRATCHPAD_DIR` is unset — that just skips scratchpad
cleaning.) The script cleans the scratchpad, resolves **this session's** CLI process
(ancestor-only, never a sibling), detaches a watcher that erases the transcript the CLI
re-creates on its way out, and closes the CLI (Ctrl-C twice, escalating to SIGTERM).

**Background agent** (`claude --bg`) — it has no TTY and cannot close itself with
signals, so arm the watcher first, then stop the job by its short id (the first 8
characters of `$CLAUDE_CODE_SESSION_ID`):

```
bash ~/.claude/skills/delete/scripts/delete-session.sh --watch-only
claude stop <short-id>
```

Skipping `--watch-only` is what left the regrown transcript on disk (observed
2026-08-25): the CLI's exit flush re-creates the `.jsonl` that `forget` destroyed, and
`claude stop` alone never removes it. The SessionEnd hook's `take --hook` runs inside the
CLI before it dies and archives that regrown file with a queue pointer, so once the process
is gone the watcher retires a live job (`claude rm`, as `/dissolve` does) and runs
`sandman forget` again (observed 2026-10-26 · probe under a fake
`SANDMAN_ROOT`: forget, regrow, `take --hook` archived it). (verified 2026-07-29 · live probe, Claude Code 2.1.220: `claude stop` fires
`SessionEnd(reason=other)`.)

### Caveats — state them, don't hide them

- **`~/.claude/history.jsonl` survives.** It keeps one line per prompt (cwd + the prompt
  text) and is Claude Code's own file, not sandman's — nothing here touches it. A
  hard-deleted conversation's PROMPTS live there until that file is filtered by hand.
- **Claude Code's other per-session files survive** — `~/.claude/file-history/<sid>/`
  (pre-edit snapshots), `~/.claude/session-env/<sid>`, and background-task output under
  the temp dir's `<sid>/tasks/` (observed 2026-10-26); neither `forget` nor the watcher
  touches them.
- **The exit is best-effort.** The signal is sent from inside a running tool call and the
  CLI may absorb the first interrupt as a turn-cancel. If the script reports "still
  running", tell the user to type `/exit` — the watcher erases the transcript however the
  process ends.
- If the terminal looks wrong after exit (raw mode), `reset` fixes it.

## Completion

Only when step 3 printed `is erased; the exit flush is watched`, state plainly that the
conversation is gone and that nothing was kept:

> Conversation erased — no buffer copy left, nothing extractable, not recoverable.

Otherwise (non-zero exit, nothing armed) relay its fallback: the exit flush will regrow the
transcript, so `/exit`, then `sandman forget <sid>` from outside.
