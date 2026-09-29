---
name: dissolve
description: THE take — end the current conversation and move it into sandman's short-term memory, where the dream pass extracts from it later. Stops this session's background jobs, closes the session, and lets the take run only after the process is gone; the transcript is archived by rename into ~/.sandman/.archive/ and a pointer minted in memories/.recent/. The take ending; /delete is the forget ending. An ended conversation leaves the live/resumable set. Triggers on "/dissolve", "dissolve this session", "end this session and remember it", "take this session", "wrap up and exit".
---

# Dissolve → the conversation is taken

The transcript stops being live and becomes material: archived by rename into
`~/.sandman/.archive/claude/YYYY/MM/DD/…`, pointed at by
`~/.sandman/memories/.recent/<sid>.json`, extracted by the dream pass. `/delete` is the
other ending — it leaves nothing.

Run the steps **in order** — this is live work only a running session can do.

## 1. Stop background jobs — only the ones THIS session started

Do **not** `pkill` by name; other sessions run their own dev servers and tasks. Kill only
processes you launched this session, by their **specific PIDs**. If you started nothing,
say so and move on.

If the session holds durable insight it has not yet banked, commit it **now**:

```
~/.local/bin/sandman remember "<body>"
```

The take archives the transcript for dreaming, but a memory the session already knows it
wants should not wait on the dream pass to rediscover it.

## 2. Do NOT take by hand before exiting

The SessionEnd hook already runs `sandman take --hook` (`~/.claude/settings.json`), so an
interactive session is taken simply by exiting — and an explicit take **before** exit is
harmful. Claude Code's exit flush re-creates `<sid>.jsonl`, the hook takes that live
fragment, and `.recent/<sid>.json` is overwritten to name a stub while the real
conversation sits orphaned in the archive (sandman observed this across twelve sessions on
2026-08-25; `※ resume-is-not-an-ending` in sandman's cli.rs). The dispatcher
armed in step 3 does the take after the process is gone, when the file is final.

## 3. End the session

**Interactive session:**

```
bash ~/.claude/skills/dissolve/scripts/dissolve-session.sh "$CLAUDE_SCRATCHPAD_DIR"
```

(Omit the argument if `$CLAUDE_SCRATCHPAD_DIR` is unset — that just skips scratchpad
cleaning.) The script cleans the scratchpad, resolves **this session's** CLI process
(ancestor-only, never a sibling), detaches a take dispatcher, and closes the CLI (Ctrl-C
twice, escalating to SIGTERM). There is no `/stop` slash command; `/exit` is the
interactive way out.

**Background agent** (`claude --bg`) — it has no TTY and cannot close itself with signals,
so arm the dispatcher first, then stop the job by its short id (the first 8 characters of
`$CLAUDE_CODE_SESSION_ID`):

```
bash ~/.claude/skills/dissolve/scripts/dissolve-session.sh --watch-only
claude stop <short-id>
```

`claude stop` fires `SessionEnd(reason=other)` (verified 2026-07-29, Claude Code 2.1.220)
and keeps the conversation resumable via `claude attach` — which is exactly why the hook
**declines**: `take --hook` refuses any session a `~/.claude/jobs/<short>/state.json` still
names as `resumeSessionId` ("declined live-job") and writes the debt to
`~/.sandman/pending-takes/<sid>.json`. So the dispatcher retires the job with
`claude rm <short>` — which, unlike stop, works on already-exited sessions — and only then
takes it by hand with `--force` (the job guard is ignored by a by-hand take; `--force` is
required because a transcript touched in the last 120 s is refused as live). If `rm`
refuses — a worktree with unpushed commits, absent `--discard-unpushed` — the dispatcher
takes **nothing**: the pending-take ledger already owes that take and settles it once the
job is removed by hand (trace 2026-09-05: job 6cce7b9d declined at 17:37, reclaimed at
17:41). Taking a session a job can still resume is what caused the 2026-08-26 incident — a
3.8 MB conversation pulled out from under its job, then three recreated stubs taken.

Both id variables are read (`CLAUDE_SESSION_ID` first, then `CLAUDE_CODE_SESSION_ID`)
because only the latter is set in a background job, and a caller acting for another session
overrides by exporting the former (observed 2026-08-25).

### Caveats — state them, don't hide them

- **The exit is best-effort.** The signal is sent from inside a running tool call and the
  CLI may absorb the first interrupt as a turn-cancel. If the script reports "still
  running", tell the user to type `/exit` — the dispatcher takes the session however the
  process ends.
- **The dispatcher is detached and silent.** Every decision it makes — `job-retired`,
  `rm-failed`, `hook-took`, `pointer-stale`, `stub-removed`, `took`, `take-failed` — is journalled to
  `~/.sandman/.trace/dissolve-<date>.log`. That file is the only way an outcome can be
  explained after the fact.
- **`~/.claude/history.jsonl` survives.** It keeps one line per prompt and is Claude Code's
  own file, not sandman's — nothing here touches it.
- If the terminal looks wrong after exit (raw mode), `reset` fixes it.

## Completion

State plainly that the conversation has left the live set and where it went.

> Conversation dissolved — taken into ~/.sandman for dreaming; the transcript leaves the
> live set once the process exits.
