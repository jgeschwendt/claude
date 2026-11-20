---
name: end
description: Finish what is owed, give the final report, then close this session yourself; the transcript is archived as on any exit. Use on "/end", "end the session", "close this session when you're done"; an argument is the condition to finish first ("/end after the tests pass"). Erasing instead is /delete.
argument-hint: '[condition]'
---

# /end

$ARGUMENTS

The owner is done with this session and wants it closed for him once the work is. An argument names what must hold first; none means what is already in flight.

## Before closing

- Finish and verify what is owed, or what the condition names. Start nothing new.
- Park anything irreversible or outward-facing (a push, a merge, a send, a deploy, a deletion) as ready and awaiting his word.
- Kill only processes this session started, by their own PIDs.
- A background job that owes a `result:` line writes it now.
- If the condition cannot be met, say why and do not close.

Then give the final report, three buckets, a line apiece: **done**, **parked**, **needs you**.

## Close

The last action of the turn; write nothing after it.

```sh
bun "${CLAUDE_SKILL_DIR}/session.ts"
```

`▸ ending <id>` means the close is underway: a background job is stopped, an interactive CLI interrupted, and the exit archives the transcript (unverified 2026-11-19 · for the interrupt, changelog 2.1.323 only). Any other line is a fallback to relay as it stands: the session is still open.

A message from him before the close lands wins: the ending is cancelled unless he repeats it.
