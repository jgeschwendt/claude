---
name: delete
description: Erase the current conversation so that nothing of it is kept, then close the session: no archive copy, no memory extraction, not recoverable. Every other ending, /end included, is archived into sandman. Use on "/delete", "delete this session", "erase this session".
---

# /delete

For material that should never have been written down. Stop at the first step that fails.

## 1. Stop what this session started

Kill only processes this session launched, by their own PIDs. Other sessions run their own servers and jobs. If you started nothing, say so.

## 2. Erase and close

The last tool call of the turn:

```sh
bun ~/.claude/skills/end/session.ts --erase
```

## 3. Say what survives

Only on `▸ erased <sid>; the exit is watched`, tell the owner the conversation is erased and not recoverable, and that what survives is outside this session's files: a memory a consolidate already merged keeps that text in its body, and this reply may still be on his screen or in his terminal's scrollback. Any other line is a fallback to relay as it stands: nothing is erased until it is done by hand.
