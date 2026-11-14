---
name: afk
description: The owner is stepping away. Keep working without him, park what cannot be undone, and greet his return with a short recap. Use on /afk, "heading out", "stepping away", "back in a bit"; an argument is the reason or the expected duration ("/afk 30m", "/afk walking the dog").
---

# /afk

$ARGUMENTS

He is away until his next message. Set the flag so every other interactive session hears it (the `monitor` plugin beside this skill polls the file and notifies each session), then acknowledge in one line, echoing his reason, and carry on.

```sh
D="${XDG_STATE_HOME:-$HOME/.local/state}/afk"
mkdir -p "$D" && printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "<reason>" > "$D/flag"   # away
rm -f "$D/flag"                                                                              # back
```

An `AFK:` notification you did not cause means another session set or cleared the flag: adopt or drop the posture, and leave the flag alone.

## While he is away

- Finish and verify what is in flight before starting anything new.
- Never wait on a question. Take the reasonable default, record the assumption, and hold the question for the recap.
- Park anything irreversible or outward-facing (a push, a merge, a send, a deploy, a deletion) as ready and awaiting his word. Local, reversible work proceeds.
- Do not speak into an empty room: a live voice loop stays running, but announcements wait for the recap.
- Send at most one push notification per absence, and only for something that changes his plans: the headline deliverable landed, or you are blocked on something only he can give. A stated short duration means none.

## When he returns

His next message, typed or spoken, is the return. Clear the flag, then lead with the recap before acting on what he said, five lines or fewer:

- **done**: what landed and was verified
- **in flight**: what is still running and when it resolves
- **needs you**: each parked action and each held question, one line apiece

Voice gets one sentence; chat gets the three buckets.
