#!/usr/bin/env bash
# delete-session.sh — close THIS session after `/delete` has erased it, and make sure
# the erase survives the CLI's own exit. Used by nothing else: ending a session normally is
# the SessionEnd router's job, and un-resumable-ness is no longer a goal (Claude Code keeps
# its transcripts, `cleanupPeriodDays: 365`).
#
# Usage: delete-session.sh [scratchpad_dir]
#        delete-session.sh --watch-only        # arm the watcher, close nothing
#
# Flow: clean the scratchpad → resolve THIS session's CLI process (ancestor-only, never a
# sibling) → detach a watcher that erases the transcript the CLI writes on its way out →
# close the CLI (Ctrl-C twice, escalating to SIGTERM).
#
# The watcher is the load-bearing half. `sandman forget` erases the live `.jsonl` while the
# CLI is still running, and the CLI's final flush RE-CREATES it — a write that happens
# after every in-session tool call has returned, so nothing in-session can prevent it. The
# watcher outlives the CLI, waits for the pid to die, and erases whatever regrew — and
# `sandman forget`s again: the SessionEnd hook's `take --hook` runs inside the CLI before it
# dies and archives the regrown file with a queue pointer, which only forget reaches.
#
# --watch-only exists for a background agent (`claude --bg`), which cannot close itself
# with signals: arm the watcher here, then stop the job from outside with
# `claude stop <short-id>`. Without it that ending leaves the regrown transcript on disk.
#
# Self-contained by rule: this script is the last thing a deleted conversation runs, so it
# depends on nothing but bash, the paths below and `sandman` (best-effort: absent, the
# projects sweep still runs). (The sid/component/projects-dir helpers
# were sourced from the orrery clone until 2026-08-25; they are inlined now.)
#
# Nothing is ever archived, copied, or buffered here. `/delete` is the ending that
# leaves nothing.
set -u

FLUSH_GRACE_SECONDS=0.6
INT_GAP_SECONDS=0.4
SIGNAL_GRACE_SECONDS=0.6
WATCH_POLL_SECONDS=0.3

PROJECTS_DIR="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"

watch_only=0
scratchpad=""
for arg in "$@"; do
  case "$arg" in
    --watch-only) watch_only=1 ;;
    *) scratchpad="$arg" ;;
  esac
done

# ─── session identity ─────────────────────────────────────────────────────────
# CLAUDE_CODE_SESSION_ID is the variable Claude Code actually exports; CLAUDE_SESSION_ID is
# read first so a caller acting FOR another session — a hook holding its payload's
# `session_id` — overrides the ambient id by exporting it. (Observed 2026-08-25: in a
# background job only CLAUDE_CODE_SESSION_ID is set, so the fallback is load-bearing.)
sid="${CLAUDE_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}"

# A sid becomes a FILENAME below, so it must be one path component and never a traversal.
case "$sid" in
  '' | '.' | '..' | */*)
    echo "  ✻ No usable session id — can't identify the conversation to close. Type /exit."
    exit 1
    ;;
esac

# ─── clean scratchpad (session-isolated — safe to rm) ──────────────────────────
if [ -n "$scratchpad" ] && [ -d "$scratchpad" ] && printf '%s' "$scratchpad" | grep -q '/scratchpad$'; then
  find "${scratchpad:?}" -mindepth 1 -delete 2>/dev/null
  echo "  ▸ cleaned scratchpad: $scratchpad"
fi

# ─── resolve THIS session's CLI process (ancestor only — never a sibling) ──────
# A background worker titles itself (`claude bg-spare`), so only the first word of the title
# is compared; the bare-path `claude daemon` and its `bg-pty-host` sit above the worker and
# are never the session — refuse rather than walk on to them (a dispatcher armed on the
# daemon's pid waited for a daemon restart, 2026-09-05).
resolve_cli_pid() {
  local pid comm args
  pid=$PPID
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null | sed 's#.*/##; s/[[:space:]].*//')
    if [ "$comm" = "claude" ]; then
      args=$(ps -o args= -p "$pid" 2>/dev/null)
      case " $args " in
        *" daemon "* | *" bg-pty-host "*) return 1 ;;
      esac
      echo "$pid"
      return 0
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
  return 1
}
cli_pid="$(resolve_cli_pid || true)"

# A background worker holds a pty, so the TTY test below would not save it from the
# interrupts; a live job (its `state.json` still present) is closed from outside.
[ -f "${CLAUDE_JOBS_DIR:-$HOME/.claude/jobs}/${sid:0:8}/state.json" ] && watch_only=1

if [ -z "$cli_pid" ]; then
  echo "  ✻ Could not identify this session's CLI process safely — nothing closed."
  echo "    Interactive: type /exit. Background agent: stop it from outside"
  echo "    (claude stop <short-id>). The erase already ran; re-run sandman forget"
  echo "    afterwards to remove the transcript the exit flush re-creates."
  exit 0
fi

# ─── the regrowth watcher ─────────────────────────────────────────────────────
# Detached so it outlives the CLI. The child gets its inputs as ARGUMENTS, so no path can
# reshape the command it runs; it polls until the pid is gone, waits out the OS flush, and
# removes any `<sid>.jsonl` that came back in any project dir, plus the subagent directory
# Claude Code writes beside it. No nullglob in the child — the `-f`/`-d` tests are what make
# an unmatched glob a no-op.
# shellcheck disable=SC2016
nohup bash -c '
  sid="$1"; pid="$2"; projects="$3"; poll="$4"; flush="$5"; sandman="$6"
  while kill -0 "$pid" 2>/dev/null; do sleep "$poll"; done
  sleep "$flush"
  for t in "$projects"/*/"$sid".jsonl; do
    [ -f "$t" ] && rm -f "$t"
  done
  for d in "$projects"/*/"$sid"; do
    [ -d "$d" ] && rm -rf "$d"
  done
  "$sandman" forget "$sid"
' _ "$sid" "$cli_pid" "$PROJECTS_DIR" "$WATCH_POLL_SECONDS" "$FLUSH_GRACE_SECONDS" "${SANDMAN_BIN:-$HOME/.local/bin/sandman}" \
  >/dev/null 2>&1 &
disown

echo "  ▸ Conversation $sid is erased; the exit flush is watched and erased too."

if [ "$watch_only" -eq 1 ]; then
  echo "  ▸ --watch-only: nothing closed. Stop this agent from outside:"
  echo "      claude stop ${sid:0:8}"
  exit 0
fi

# ─── close the session: Ctrl-C twice, escalate to TERM ────────────────────────
# A session with no controlling TTY (a `claude -p` run, a detached job) absorbs these
# signals as turn-cancels, so don't pretend: report plainly that it must be stopped from
# outside. The erase and the watcher are already secured either way.
alive() { kill -0 "$1" 2>/dev/null; }
cli_tty=$(ps -o tty= -p "$cli_pid" 2>/dev/null | tr -d ' ')
if [ -z "$cli_tty" ] || [ "$cli_tty" = "??" ]; then
  echo "  ✻ No TTY on CLI pid $cli_pid — in-session signals cannot close it. Stop it from"
  echo "    outside (claude stop ${sid:0:8}, or kill $cli_pid); the watcher erases the"
  echo "    transcript whenever the process exits."
  exit 0
fi

echo "  Closing session (CLI pid $cli_pid)…"
kill -INT "$cli_pid" 2>/dev/null; sleep "$INT_GAP_SECONDS"
kill -INT "$cli_pid" 2>/dev/null; sleep "$SIGNAL_GRACE_SECONDS"
if alive "$cli_pid"; then kill -TERM "$cli_pid" 2>/dev/null; sleep "$SIGNAL_GRACE_SECONDS"; fi
if alive "$cli_pid"; then
  echo "  ✻ Still running — signals absorbed. Type /exit; the watcher erases the transcript once the process exits."
fi
