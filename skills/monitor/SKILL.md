---
name: monitor
description: The cross-session broadcast mechanism — a background monitor watches a shared flag file and delivers every transition to every interactive session as a notification. This is the plumbing /afk rides on; a session makes the tool call (writing or clearing the flag) and the monitor dispatches the resulting event to every other session. Use when inspecting, debugging, or extending the flag-broadcast monitor, or when asked where the afk/broadcast monitor lives.
---

# /monitor — the cross-session broadcast plumbing

This plugin registers one background monitor, `monitor`, that Claude Code starts in
every interactive session. It polls a shared flag file and emits one
notification on every transition, so state written in one session reaches all
the others without any of them being asked to watch.

## What a monitor can and cannot do

(verified 2026-09-03 · code.claude.com/docs/en/plugins-reference#monitors)

A plugin monitor runs a shell command for the session's lifetime and delivers
**every stdout line to Claude as a notification** — text only. It **cannot**
dispatch a tool call or trigger an action directly; the receiving session reads
the notification and chooses to act. So the flow is always: one session makes a
tool call (writes or clears the flag), the monitor observes it and dispatches a
line of text, and each session acts on that text.

- **Registration** — `monitors/monitors.json`, one entry `monitor`. The command is
  `${CLAUDE_PLUGIN_ROOT}/monitor.sh`, left unquoted (the expansion has
  no spaces; a quoted path is display-hostile in the details panel).
- **Poller** — `monitor.sh`, a `sleep`-loop (`AFK_POLL_SECONDS`, default 5) that snapshots the flag,
  emits an away line when it appears or changes and a return line when it clears.
  A session launched mid-absence emits the away line once at arm time, so it
  learns the state it woke into.
- **Reach** — only interactive CLI sessions carry monitors; background jobs never
  hear the broadcast and need not, being autonomous already.

## The flag protocol

One flag file carries the state across sessions. Writing it is the "tool call";
the monitor is what dispatches it onward.

```sh
D="${XDG_STATE_HOME:-$HOME/.local/state}/afk"
mkdir -p "$D" && printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "<reason>" > "$D/flag"
rm -f "$D/flag"
```

- **Write** — one line, `<ISO-8601 timestamp> <reason>`, reason optional. Every
  interactive session, including one started mid-absence, is told to adopt the
  posture the moment its monitor reads the flag.
- **Clear** — removing the flag broadcasts the return everywhere.
- **Echo** — the session that flipped the flag hears its own transition too;
  ignore that one rather than re-writing.

The `/afk` skill is the consumer: it decides _when_ to write and clear the flag
and _what posture_ to hold. This skill owns only the mechanism.
