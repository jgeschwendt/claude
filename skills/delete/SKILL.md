---
name: delete
description: Erase the current conversation so that nothing of it is kept: no archive copy, no memory extraction, not recoverable. Every other ending is archived into sandman. Use on "/delete", "delete this session", "erase this session".
---

# /delete

Exiting a session normally archives its transcript into `~/.sandman` for later extraction. This ending leaves nothing, for material that should never have been written down. Run the three steps in order.

## 1. Stop what this session started

Kill only processes this session launched, by their own PIDs. Other sessions run their own servers and jobs. If you started nothing, say so.

## 2. Erase

```sh
~/.local/bin/sandman-next forget "${CLAUDE_SESSION_ID:-$CLAUDE_CODE_SESSION_ID}"
```

It drops the session's ledger lines first, so the exit's take archives nothing, then removes the live transcript, its subagent files, any archived copy, the short-term pointer and every memory, knowledge page and trace attributed to the session (a `remember --session` note included), and scrubs the id from what remains. What a consolidate merged into another memory stays in that memory's body. It prints `forgot: <n> removed, <n> rewritten`, or `nothing to forget`, exit 0; any other exit is a failed erase to relay. A background job sets only `CLAUDE_CODE_SESSION_ID`, which is why both are read.

## 3. End the session

Claude Code rewrites the transcript as it exits, and a late guard mark or an encode in flight can name the session after the erase, so the script arms a detached watcher that deletes the regrown transcript and runs `forget` again once the process is gone. Never skip it.

Interactive session (drop the argument when `$CLAUDE_SCRATCHPAD_DIR` is unset):

```sh
bash ~/.claude/skills/delete/scripts/delete-session.sh "$CLAUDE_SCRATCHPAD_DIR"
```

Background job, which cannot signal itself: arm the watcher, then stop the job by the first eight characters of `$CLAUDE_CODE_SESSION_ID`.

```sh
bash ~/.claude/skills/delete/scripts/delete-session.sh --watch-only
claude stop <short-id>
```

If the script reports the session still running, ask him to type `/exit`; the watcher erases the transcript however the process ends.

## Say what survives

Only when step 3 printed `is erased; the exit flush is watched`, tell him the conversation is erased and not recoverable. Otherwise relay the script's fallback: the exit will regrow the transcript, so `/exit`, then `sandman-next forget <sid>` from outside.

Either way, name what Claude Code itself keeps, which nothing here touches: `~/.claude/history.jsonl` holds each prompt's text until it is filtered by hand, and `~/.claude/file-history/<sid>/`, `~/.claude/session-env/<sid>` and background-task output under the temp directory's `<sid>/tasks/` remain.
