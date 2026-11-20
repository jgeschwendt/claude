# Daemons

A long-running process of ours (`grove serve`, `sandman serve`) meets every line below; a new one ships with all of them, an old one is brought up to them when next touched.

- **Disk is the truth, memory a cache.** A kill at any instant loses nothing a cold boot cannot re-derive; a restart is the recovery path, so it is tested.
- **Every stop signal drains.** SIGTERM, SIGINT and SIGHUP run the same graceful path as the shutdown request: stop accepting first, then reply, finish or abandon in-flight work inside a stated budget that fits launchd's kill timeout, kill owned children, log one exit line, exit 0. launchd and an upgrade both stop a daemon with SIGTERM, so an unhandled one is a data-loss bug.
- **launchd owns the process.** `dev.gigantic.<project>[.<job>]` for a gigantic.dev project's agents, `io.jlg.*` for personal host services (kev), with KeepAlive and RunAtLoad; a label change ships with its installer's migration (bootout the old label, remove the old plist, dated comment); a swap is one `launchctl kickstart -k`, never a drain raced against KeepAlive's respawn. The CLI works with the daemon down, or says plainly that it is down.
- **One instance, by lock.** An exclusive `flock` held for the process's life decides it; a pid file is a hint and is checked against the process's identity before any signal is sent from it.
- **Local transport is a unix socket** in a 0700 directory the daemon creates and checks the owner of. Loopback TCP is for a surface a browser must reach, and then carries Host and Origin checks.
- **Client and daemon shake hands on version.** Health carries the daemon's version; a client that differs says so in one line and names the fix. Errors are typed codes, never matched by message text.
- **Ready means ready.** Health reports booting until state is derived, degraded when a dependency is failing, stopping during the drain.
- **A client retries only what was provably not sent**; anything else returns "outcome unknown" unless the request is read-only.
- **Owned children run in their own process group** and die with the daemon, by group.
- **The daemon owns its log**: size-capped rotation, a start line with version and pid, an exit line with the reason, a panic hook that logs before the process dies. A death that leaves no line is a bug.
- **The lifecycle is tested end to end** against the built binary: start, second instance refused, SIGTERM drains, stale files after a kill are recovered, version mismatch is reported.

(since 2026-11-11 · grove vs agent-browser 0.42.0 daemon comparison: grove handled no SIGTERM and its upgrade drain raced launchd's respawn; "i want to make grove and sandman run the best deamon we can")
