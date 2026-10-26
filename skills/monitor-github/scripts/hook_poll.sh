#!/usr/bin/env bash
# hook_poll.sh — Claude Code hook adapter for the github-monitor daemon.
#
# Wire this into UserPromptSubmit (and optionally SessionEnd) in
# ~/.claude/settings.json; `monitor.sh hook-config` prints the ready snippet.
#
# On each user prompt it drains this conversation's notification queue and
# prints it to stdout — UserPromptSubmit (and SessionStart) are the hook
# events where stdout is injected as context Claude can see. The first fire
# auto-attaches a monitor session scoped by the conversation's cwd, so a
# conversation opened inside a repo clone is scoped to that repo, and any
# other conversation is global-minus-claimed — the same routing rule as
# manual attach. Polling doubles as the heartbeat, so when the conversation
# goes quiet the session expires and its repo claim is released.
#
# Safety: this script must never break the user's prompt. Exit 2 would BLOCK
# the prompt, so it always exits 0 and stays silent when there's nothing to say.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
M="$SCRIPT_DIR/monitor.sh"
DIR="${GITHUB_MONITOR_DIR:-$HOME/.local/state/github-monitor}"
MAP="$DIR/cc-map"
mkdir -p "$MAP" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
CC_SID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "UserPromptSubmit"' 2>/dev/null || true)"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$CC_SID" ] || exit 0
MAPF="$MAP/$CC_SID"

# Optional SessionEnd wiring: detach immediately instead of waiting for TTL.
if [ "$EVENT" = "SessionEnd" ]; then
  if [ -f "$MAPF" ]; then
    bash "$M" detach "$(cat "$MAPF")" >/dev/null 2>&1 || true
    rm -f "$MAPF"
  fi
  exit 0
fi

MON_SID=""
[ -f "$MAPF" ] && MON_SID="$(cat "$MAPF" 2>/dev/null || true)"

if [ -z "$MON_SID" ] || { [ ! -f "$DIR/sessions/$MON_SID.json" ] && [ ! -f "$DIR/sessions/$MON_SID.pruned" ]; }; then
  out="$( { cd "${CWD:-.}" 2>/dev/null || true; bash "$M" attach 2>/dev/null; } || true)"
  MON_SID="$(printf '%s' "$out" | jq -r '.session // empty' 2>/dev/null || true)"
  [ -n "$MON_SID" ] || exit 0
  printf '%s' "$MON_SID" > "$MAPF"
  scope="$(printf '%s' "$out" | jq -r '.scope // "all repos (minus repos claimed by other sessions)"' 2>/dev/null || true)"
  echo "[github-monitor] Monitoring active for this conversation. Scope: $scope. Monitor session: $MON_SID. New GitHub events will appear here alongside future messages."
fi

EVENTS="$(bash "$M" poll "$MON_SID" 2>/dev/null || true)"
[ -n "$EVENTS" ] || exit 0
COUNT="$(printf '%s\n' "$EVENTS" | grep -c . || true)"
echo "[github-monitor] $COUNT GitHub notification(s) for this conversation:"
printf '%s\n' "$EVENTS" | head -30 \
  | jq -r '"- [" + (.severity | ascii_upcase) + "] " + .title + (if .url then " — " + .url else "" end)' 2>/dev/null \
  || printf '%s\n' "$EVENTS" | head -30
if [ "$COUNT" -gt 30 ]; then
  # Requeue the rest ahead of anything the daemon appended since the drain.
  Q="$DIR/queues/$MON_SID.jsonl"; mv "$Q" "$Q.$$" 2>/dev/null
  { printf '%s\n' "$EVENTS" | tail -n +31; cat "$Q.$$" 2>/dev/null; } >> "$Q"; rm -f "$Q.$$"
  echo "…and $((COUNT - 30)) more, requeued (next prompt, or bash $M poll $MON_SID)."
fi
echo "(Briefly surface high-severity items to the user, then continue with their actual request.)"
exit 0
