#!/usr/bin/env bash
# dissolve-session.sh — close THIS session and hand the conversation to sandman's short-term
# memory. The mirror of delete-session.sh: same skeleton, opposite ending. `/delete` erases
# the transcript; `/dissolve` takes it — archived by rename into `~/.sandman/.archive/` with
# a pointer in `memories/.recent/` that the dream pass later extracts memories from.
#
# Usage: dissolve-session.sh [scratchpad_dir]   # interactive: arm dispatcher, close the CLI
#        dissolve-session.sh --watch-only        # background: arm dispatcher, close nothing;
#                                                # caller then runs `claude stop <short-id>`
#
# Flow: clean the scratchpad → resolve THIS session's CLI process (ancestor-only, never a
# sibling) → detach a TAKE DISPATCHER that runs after the process is gone → close the CLI
# (Ctrl-C twice, escalating to SIGTERM).
#
# Why the take must run AFTER exit: the SessionEnd hook already runs `sandman take --hook`,
# so an interactive session is taken simply by exiting. Taking BEFORE exit is actively
# harmful — Claude Code's exit flush re-creates `<sid>.jsonl`, the hook takes that live
# fragment, and `.recent/<sid>.json` is overwritten to name a stub while the real
# conversation sits orphaned in the archive (sandman observed this across twelve sessions on
# 2026-08-25; see `※ resume-is-not-an-ending` in sandman's cli.rs). The
# dispatcher therefore waits out the pid, the flush, and the hook's own take before deciding
# anything.
#
# Why rm precedes take in background mode: `take --hook` DECLINES any session a live job
# still names as `resumeSessionId`, and a taken session a job can still resume gets a stub
# recreated on resume (the 2026-08-26 incident: a 3.8 MB conversation pulled out from under
# its job, then three recreated stubs taken). So the dispatcher retires the job with
# `claude rm <short>` first, and if that fails it takes NOTHING — `take --hook` has already
# written the debt to `~/.sandman/pending-takes/<sid>.json`, and a later take or reflect
# settles it once the job is gone (trace 2026-09-05: job 6cce7b9d declined at 17:37,
# reclaimed at 17:41).
#
# Self-contained by rule: this script is the last thing a dissolving conversation runs, so it
# depends on nothing but bash and the paths below.
set -u

FLUSH_GRACE_SECONDS=0.6
HOOK_GRACE_SECONDS=2
INT_GAP_SECONDS=0.4
SIGNAL_GRACE_SECONDS=0.6
WATCH_POLL_SECONDS=0.3

JOBS_DIR="${CLAUDE_JOBS_DIR:-$HOME/.claude/jobs}"
PROJECTS_DIR="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
SANDMAN_BIN="${SANDMAN_BIN:-$HOME/.local/bin/sandman}"
SANDMAN_ROOT_DIR="${SANDMAN_ROOT:-$HOME/.sandman}"

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
    echo "  ✻ No usable session id — can't identify the conversation to dissolve. Type /exit."
    exit 1
    ;;
esac
short="${sid:0:8}"

# ─── clean scratchpad (session-isolated — safe to rm) ──────────────────────────
if [ -n "$scratchpad" ] && [ -d "$scratchpad" ] && printf '%s' "$scratchpad" | grep -q '/scratchpad$'; then
  rm -rf "${scratchpad:?}/"* 2>/dev/null
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

if [ -z "$cli_pid" ]; then
  echo "  ✻ Could not identify this session's CLI process safely — nothing armed."
  echo "    Interactive: type /exit; the SessionEnd hook takes the session on its own."
  echo "    Background agent: retire the job (claude rm $short), then"
  echo "    $SANDMAN_BIN take $sid --force."
  exit 0
fi

# The job dir is resolved HERE, in the parent, and handed to the child as an argument —
# background mode is a fact about the environment, not something the detached child guesses.
# A job is live only while its `state.json` exists: a retired job leaves its directory behind
# with nothing but `tmp` inside (14 of 24 dirs under ~/.claude/jobs on 2026-09-05).
job_dir=""
[ -f "$JOBS_DIR/$short/state.json" ] && job_dir="$JOBS_DIR/$short"
# A background worker holds a pty, so the TTY test below would not save it from the
# interrupts; a live job is closed from outside, whatever the caller asked for.
[ -n "$job_dir" ] && watch_only=1

# ─── the take dispatcher ──────────────────────────────────────────────────────
# Detached so it outlives the CLI. The child gets its inputs as ARGUMENTS, so no path can
# reshape the command it runs. It polls until the pid is gone, waits out the OS flush and the
# SessionEnd hook's own take, then decides: retire a live job first (background mode), take
# nothing if that fails, honour the hook's take if a pointer already exists (removing only a
# regrown fragment that is strictly smaller than what was archived), else take by hand with
# --force (a transcript touched in the last 120 s is otherwise refused as live).
#
# Every decision is journalled to `$SANDMAN_ROOT_DIR/.trace/dissolve-<date>.log`. The child
# is detached and its exit code goes nowhere, so that journal is the ONLY way its outcome can
# be explained afterwards.
# shellcheck disable=SC2016
nohup bash -c '
  sid="$1"; pid="$2"; projects="$3"; poll="$4"; flush="$5"; hookgrace="$6"
  sandman="$7"; root="$8"; jobdir="$9"
  export PATH="$HOME/.local/bin:$PATH"

  mkdir -p "$root/.trace" 2>/dev/null
  trace="$root/.trace/dissolve-$(date -u +%Y-%m-%d).log"
  # A pointer counts as the hook take only if it is NEWER than this mark: a session resumed
  # after an earlier take already has a `.recent/<sid>.json`, and trusting that stale
  # pointer would skip the take — and could mistake the live transcript for a stub.
  mark="$root/.trace/.dissolve-$sid.mark"
  : >"$mark" 2>/dev/null
  journal() {
    printf "%s pid=%s %s session=%s %s\n" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$1" "$sid" "${2:-}" >>"$trace" 2>/dev/null
  }

  while kill -0 "$pid" 2>/dev/null; do sleep "$poll"; done
  sleep "$flush"
  sleep "$hookgrace"
  journal cli-exited "job=${jobdir:-none}"

  # background mode: the job must be gone before the take, never after.
  if [ -n "$jobdir" ] && [ -f "$jobdir/state.json" ]; then
    short="${sid:0:8}"
    cli="$(command -v claude 2>/dev/null || true)"
    [ -n "$cli" ] || cli="$HOME/.local/bin/claude"
    if err="$("$cli" rm "$short" 2>&1 >/dev/null)"; then
      journal job-retired "job=$short"
    else
      journal rm-failed "job=$short err=$(printf %s "$err" | tail -n 1)"
      rm -f "$mark"
      exit 0
    fi
  fi

  # the hook may already have taken it; if so, only tidy a regrown stub.
  pointer="$root/memories/.recent/$sid.json"
  if [ -f "$pointer" ] && [ "$pointer" -nt "$mark" ]; then
    rm -f "$mark"
    journal hook-took "pointer=$pointer"
    archived="$(sed -n "s/.*\"archived\":\"\([^\"]*\)\".*/\1/p" "$pointer" | head -n 1)"
    for t in "$projects"/*/"$sid".jsonl; do
      [ -f "$t" ] || continue
      if [ -n "$archived" ] && [ -f "$archived" ]; then
        n="$(stat -f %z "$t" 2>/dev/null || echo 0)"
        m="$(stat -f %z "$archived" 2>/dev/null || echo 0)"
        if [ "$n" -lt "$m" ]; then
          rm -f "$t"
          journal stub-removed "bytes=$n archived=$m path=$t"
          continue
        fi
      fi
      journal stub-kept "path=$t"
    done
    exit 0
  fi

  [ -f "$pointer" ] && journal pointer-stale "pointer=$pointer"
  if out="$("$sandman" take "$sid" --force 2>&1)"; then
    journal took "$(printf %s "$out" | head -n 1)"
  else
    journal take-failed "$(printf %s "$out" | tail -n 1)"
  fi
  rm -f "$mark"
' _ "$sid" "$cli_pid" "$PROJECTS_DIR" "$WATCH_POLL_SECONDS" "$FLUSH_GRACE_SECONDS" \
  "$HOOK_GRACE_SECONDS" "$SANDMAN_BIN" "$SANDMAN_ROOT_DIR" "$job_dir" \
  >/dev/null 2>&1 &
disown

echo "  ▸ Take dispatcher armed for $sid; it runs once the CLI process is gone."
echo "    Journal: $SANDMAN_ROOT_DIR/.trace/dissolve-$(date -u +%Y-%m-%d).log"
if [ -n "$job_dir" ]; then
  echo "    Background job $short will be retired (claude rm) before the take."
fi

if [ "$watch_only" -eq 1 ]; then
  echo "  ▸ --watch-only: nothing closed. Stop this agent from outside:"
  echo "      claude stop $short"
  exit 0
fi

# ─── close the session: Ctrl-C twice, escalate to TERM ────────────────────────
# A session with no controlling TTY (a `claude -p` run, a detached job) absorbs these
# signals as turn-cancels, so don't pretend: report plainly that it must be stopped from
# outside. The dispatcher is already armed either way.
alive() { kill -0 "$1" 2>/dev/null; }
cli_tty=$(ps -o tty= -p "$cli_pid" 2>/dev/null | tr -d ' ')
if [ -z "$cli_tty" ] || [ "$cli_tty" = "??" ]; then
  echo "  ✻ No TTY on CLI pid $cli_pid — in-session signals cannot close it. Stop it from"
  echo "    outside (claude stop $short, or kill $cli_pid); the dispatcher takes the"
  echo "    session whenever the process exits."
  exit 0
fi

echo "  Closing session (CLI pid $cli_pid)…"
kill -INT "$cli_pid" 2>/dev/null; sleep "$INT_GAP_SECONDS"
kill -INT "$cli_pid" 2>/dev/null; sleep "$SIGNAL_GRACE_SECONDS"
if alive "$cli_pid"; then kill -TERM "$cli_pid" 2>/dev/null; sleep "$SIGNAL_GRACE_SECONDS"; fi
if alive "$cli_pid"; then
  echo "  ✻ Still running — signals absorbed. Type /exit; the dispatcher takes the session once the process exits."
fi
