#!/usr/bin/env bash
# monitor.sh — GitHub monitor daemon with per-session repo scoping.
#
# The daemon polls GitHub (via gh_dashboard.sh) every INTERVAL seconds, diffs
# against the previous snapshot, and routes notification events to attached
# sessions using this rule:
#
#   * a session attached with a repo scope receives only that repo's events
#   * a session attached globally receives every event EXCEPT those for
#     repos currently claimed by a live repo-scoped session
#   * claims are released when the scoped session detaches or goes stale
#     (no poll for SESSION_TTL seconds, default 2h)
#
# Commands:
#   monitor.sh attach [--repo O/R | --global]
#         Register this conversation. By default auto-detects a repo scope
#         from the cwd (a git clone => scoped to that repo; anywhere else
#         => global). Starts the daemon unless `stop`ped. Prints
#         {"session": ..., "scope": ..., "daemon": ...}
#   monitor.sh poll <session>     Drain pending events (JSONL; empty = no news);
#         restarts the daemon if it died (reboot, kill), not after `stop`
#   monitor.sh detach <session>   Unregister (releases any repo claim)
#   monitor.sh status             Daemon + sessions + mutes + watches (JSON)
#   monitor.sh start [--interval N]   Start daemon explicitly (idempotent)
#   monitor.sh stop               Stop the daemon (sessions are kept)
#   monitor.sh tick               Run one poll cycle in the foreground (debug)
#   monitor.sh history [--since 24h|7d|30m] [--repo O/R]
#         Print delivered events from the rolling log (default last 24h)
#   monitor.sh mute <O/R | O/R#N> [--for 4h|2d]
#         Suppress events for a repo or a single item (no --for = until unmuted)
#   monitor.sh unmute <target | --all>   Lift a mute
#   monitor.sh watch <O/R>        Watch a repo's new PRs/issues + releases
#   monitor.sh unwatch <O/R>      Stop watching a repo
#   monitor.sh hook-config        Print the Claude Code settings.json hooks
#                                 snippet that turns delivery into push (see
#                                 hook_poll.sh)
#
# State lives in ${GITHUB_MONITOR_DIR:-~/.local/state/github-monitor}.
# The collector is overridable via GITHUB_MONITOR_COLLECTOR (test seam).
# Requires: gh (authenticated), jq.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${GITHUB_MONITOR_DIR:-$HOME/.local/state/github-monitor}"
SESS="$DIR/sessions"; QUEUES="$DIR/queues"
PIDFILE="$DIR/daemon.pid"; LOG="$DIR/daemon.log"; STATE="$DIR/state.json"; LOCK="$DIR/start.lock"
INTERVAL_FILE="$DIR/interval"
HISTORY="$DIR/history.jsonl"; MUTES="$DIR/mutes.json"; WATCHES="$DIR/watches.json"
FAILC="$DIR/failcount"; DEGRADED="$DIR/degraded"
SESSION_TTL="${GITHUB_MONITOR_SESSION_TTL:-7200}"
mkdir -p "$SESS" "$QUEUES"

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }
die_json() { echo "{\"error\":\"$1\",\"hint\":\"$2\"}" >&2; exit 1; }

need_tools() {
  command -v gh >/dev/null 2>&1 || die_json gh_not_installed "Install the GitHub CLI: https://cli.github.com"
  command -v jq >/dev/null 2>&1 || die_json jq_not_installed "Install jq (apt install jq / brew install jq)"
}

# Pids recycle: daemon.pid counts only while it names our command line. Where
# ps is denied (sandbox) fall back to liveness, with EPERM from kill -0 alive.
daemon_alive() {
  local p c; p="$(cat "$PIDFILE" 2>/dev/null)" && [ -n "$p" ] || return 1
  if c="$(ps -ww -p "$p" -o command= 2>/dev/null)" || [ $? = 1 ]; then [[ "$c" == *"monitor.sh _daemon"* ]]
  else [[ "$(kill -0 "$p" 2>&1)" != *"No such process"* ]]; fi
}

interval() { local v; v="$(cat "$INTERVAL_FILE" 2>/dev/null || true)"; [[ "$v" =~ ^[1-9][0-9]*$ ]] && echo "$v" || echo 120; }

# Nm/Nh/Nd -> seconds on stdout, non-zero exit on a bad spec. Safe to call
# inside $( ) — the case lives in this function body, not in the substitution.
parse_duration() {
  local v="${1:-}"
  [[ "$v" =~ ^([0-9]+)([mhd])$ ]] || return 1
  local n="${BASH_REMATCH[1]}" u="${BASH_REMATCH[2]}"
  case "$u" in
    m) echo $(( n * 60 )) ;;
    h) echo $(( n * 3600 )) ;;
    d) echo $(( n * 86400 )) ;;
  esac
}

repo_from_cwd() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  local slug url
  if slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" && [ -n "$slug" ]; then
    echo "$slug"; return 0
  fi
  url="$(git remote get-url origin 2>/dev/null)" || return 1
  echo "$url" | sed -E 's#^(git@[^:]+:|[a-zA-Z]+://[^/]+/)##; s#\.git$##' | grep -E '^[^/]+/[^/]+$'
}

# A stale session is parked as .pruned (claim released, queue kept) so its next
# poll revives it; one parked past 7d is deleted with its queue.
prune_sessions() {
  local ttl_min=$(( SESSION_TTL / 60 )); [ "$ttl_min" -lt 1 ] && ttl_min=1
  local sf id
  for sf in "$SESS"/*.json "$SESS"/*.pruned; do
    [ -e "$sf" ] || continue
    id="$(basename "${sf%.*}")"
    if [ "$sf" != "${sf%.pruned}" ]; then
      [ -z "$(find "$sf" -mtime +7 2>/dev/null)" ] || rm -f "$sf" "$QUEUES/$id.jsonl"
    elif [ -n "$(find "$sf" -mmin +"$ttl_min" 2>/dev/null)" ]; then
      log "pruning stale session $id"
      mv -f "$sf" "$SESS/$id.pruned"
    fi
  done
}

broadcast_all() { # $1 = one event json line -> every session
  local sf id
  for sf in "$SESS"/*.json; do
    [ -e "$sf" ] || continue
    id="$(basename "$sf" .json)"
    echo "$1" >> "$QUEUES/$id.jsonl"
  done
}

# ─── mutes ──────────────────────────────────────────────────────────────────
json_array() { jq -c 'if type=="array" then . else [] end' "$1" 2>/dev/null | grep . || echo '[]'; }
load_mutes() { json_array "$MUTES"; }
purge_mutes() { # drop expired mutes; rewrite the file atomically
  local now m; now="$(date +%s)"
  m="$(load_mutes | jq -c --argjson now "$now" '[.[] | select(.until == null or .until > $now)]')"
  printf '%s\n' "$m" > "$MUTES.tmp" && mv "$MUTES.tmp" "$MUTES"
}
active_mutes() { load_mutes | jq -c '[.[].target]'; }

# ─── watches ────────────────────────────────────────────────────────────────
watches_load() { json_array "$WATCHES"; }
watches_list() { watches_load | jq -r '.[]'; }

rotate_history() { # keep the newest 2500 lines once the log passes 5000
  local n
  [ -f "$HISTORY" ] || return 0
  n="$( { wc -l < "$HISTORY"; } 2>/dev/null | tr -d '[:space:]' || echo 0)"
  [ -n "$n" ] || n=0
  if [ "$n" -gt 5000 ]; then
    tail -n 2500 "$HISTORY" > "$HISTORY.tmp" && mv "$HISTORY.tmp" "$HISTORY"
  fi
}

route_events() { # $1 = JSON array of events
  prune_sessions
  purge_mutes
  local claimed mutes evt repo key sf id scope
  claimed="$(jq -r '.scope // empty' "$SESS"/*.json 2>/dev/null | sort -u || true)"
  mutes="$(active_mutes)"
  while IFS= read -r evt; do
    [ -n "$evt" ] || continue
    repo="$(echo "$evt" | jq -r '.repo // ""')"
    key="$(echo "$evt" | jq -r '.key // ""')"
    # muted events are dropped entirely — not routed, not recorded.
    if echo "$mutes" | jq -e --arg r "$repo" --arg k "$key" \
        'any(.[]; (. == $r and $r != "") or (. == $k and $k != ""))' >/dev/null 2>&1; then
      continue
    fi
    echo "$evt" >> "$HISTORY"     # rolling delivery log (post-mute)
    for sf in "$SESS"/*.json; do
      [ -e "$sf" ] || continue
      id="$(basename "$sf" .json)"
      scope="$(jq -r '.scope // ""' "$sf")"
      if [ -n "$scope" ]; then
        # repo-scoped session: only its own repo's events
        if [ "$scope" = "$repo" ]; then echo "$evt" >> "$QUEUES/$id.jsonl"; fi
      else
        # global session: everything except repos claimed by live scoped sessions
        if [ -z "$repo" ] || ! printf '%s\n' "$claimed" | grep -qxF "$repo"; then
          echo "$evt" >> "$QUEUES/$id.jsonl"
        fi
      fi
    done
  done < <(echo "$1" | jq -c '.[]')
  rotate_history
}

# ─── collector + enrichment seams (stubbable in the selftest) ───────────────
run_collector() { # emit the dashboard JSON; overridable for tests
  if [ -n "${GITHUB_MONITOR_COLLECTOR:-}" ]; then
    eval "$GITHUB_MONITOR_COLLECTOR"
  else
    bash "$SCRIPT_DIR/gh_dashboard.sh" 50
  fi
}

gh_pr_state() { gh pr view "$1" --json state --jq .state 2>/dev/null || echo UNKNOWN; }

gh_pr_failing_checks() { # $1 = PR url -> up to 3 failing check names, comma-joined
  { gh pr checks "$1" --json name,state 2>/dev/null || true; } \
    | jq -r '[.[] | select(.state=="FAILURE" or .state=="ERROR"
             or .state=="CANCELLED" or .state=="TIMED_OUT") | .name] | .[0:3] | join(", ")' \
      2>/dev/null || true
}

# ✻ case hoisted into a function — bash 3.2 (macOS) can't parse `case` inside $( ) (see rules/bash.md)
disappeared_to_state() { # $1 = event json, $2 = PR state -> transformed event
  case "$2" in
    MERGED) echo "$1" | jq -c '.type="pr_merged"  | .title=(.title | sub(" — no longer open$"; " — merged ✓"))' ;;
    CLOSED) echo "$1" | jq -c '.type="pr_closed"  | .title=(.title | sub(" — no longer open$"; " — closed without merging"))' ;;
    OPEN)   ;;   # only out of the search window (>50 open PRs, index lag)
    *)      echo "$1" ;;
  esac
}

# Post-diff enrichment: resolve disappeared PRs and name failing checks.
# One cheap lookup per fired event only.
enrich_events() { # stdin/stdout: event JSON lines
  local e t u names
  while IFS= read -r e; do
    t="$(echo "$e" | jq -r .type)"
    if [ "$t" = "pr_disappeared" ]; then
      u="$(echo "$e" | jq -r .url)"
      e="$(disappeared_to_state "$e" "$(gh_pr_state "$u")")"
    elif [ "$t" = "ci_failed" ]; then
      u="$(echo "$e" | jq -r .url)"
      names="$(gh_pr_failing_checks "$u")"
      if [ -n "$names" ]; then
        e="$(echo "$e" | jq -c --arg n "$names" '.title = (.title + " (" + $n + ")")')"
      fi
    fi
    echo "$e"
  done
}

# ─── watched-repo collection (one extra GraphQL call + one REST call/repo) ───
WATCH_QUERY='
query($prq: String!, $isq: String!) {
  prs: search(query: $prq, type: ISSUE, first: 30) {
    nodes { __typename ... on PullRequest {
      number title url author { login } repository { nameWithOwner } } }
  }
  issues: search(query: $isq, type: ISSUE, first: 30) {
    nodes { __typename ... on Issue {
      number title url author { login } repository { nameWithOwner } } }
  }
}'

watched_graphql() { gh api graphql -f query="$WATCH_QUERY" -f prq="$1" -f isq="$2" 2>/dev/null; }
release_tag() { gh api "repos/$1/releases/latest" --jq '.tag_name' 2>/dev/null; }

collect_watched() { # echo the watched-state map, or {} when nothing is watched
  local repos qual r prq isq resp rels tag login
  repos="$(watches_list)"
  [ -n "$repos" ] || { echo '{}'; return 0; }
  login="${1:-}"
  qual=""
  for r in $repos; do qual="$qual repo:$r"; done
  qual="${qual# }"
  prq="$qual is:pr is:open -author:$login sort:created-desc"
  isq="$qual is:issue is:open -author:$login sort:created-desc"
  resp="$(watched_graphql "$prq" "$isq")" || return 1
  [ -n "$resp" ] || return 1
  rels='{}'
  for r in $repos; do
    # A failed lookup carries the last tag forward — null would re-fire on recovery.
    tag="$(release_tag "$r")" || tag="$(jq -r --arg r "$r" '.watched[$r].release // ""' "$STATE" 2>/dev/null || true)"
    rels="$(echo "$rels" | jq -c --arg r "$r" --arg t "$tag" '. + {($r): (if $t=="" then null else $t end)}')"
  done
  echo "$resp" | jq -c --argjson rels "$rels" --arg repos "$repos" '
    ($repos | split("\n") | map(select(length > 0))) as $rl
    | ([ .data.prs.nodes[]? | select(.__typename == "PullRequest")
         | {repo: .repository.nameWithOwner,
            key: (.repository.nameWithOwner + "#" + (.number|tostring)),
            title, url, author: (.author.login // "ghost"), kind: "pr"} ]
     + [ .data.issues.nodes[]? | select(.__typename == "Issue")
         | {repo: .repository.nameWithOwner,
            key: (.repository.nameWithOwner + "#" + (.number|tostring)),
            title, url, author: (.author.login // "ghost"), kind: "issue"} ]) as $items
    | reduce $rl[] as $r ({}; . + {($r): {
        keys: ([ $items[] | select(.repo == $r)
                 | {key: .key, value: {title, url, author, kind}} ] | from_entries),
        release: $rels[$r]
      }})'
}

# ─── the poll cycle ─────────────────────────────────────────────────────────
run_tick() {
  need_tools
  local raw login new watched old events resolved n fc

  if ! raw="$(run_collector 2>>"$LOG")" || ! echo "$raw" | jq -e . >/dev/null 2>&1; then
    fc=$(( $(cat "$FAILC" 2>/dev/null || echo 0) + 1 ))
    echo "$fc" > "$FAILC"
    log "collector failed ($fc consecutive)"
    if [ "$fc" -eq 3 ] && [ ! -f "$DEGRADED" ]; then
      : > "$DEGRADED"
      broadcast_all "$(jq -cn \
        --arg t "GitHub monitor cannot reach GitHub (3 failed polls) — check gh auth status and daemon.log" \
        '{ts:(now|todate),repo:null,key:null,type:"monitor_degraded",severity:"high",title:$t,url:null}')"
      log "degraded broadcast"
    fi
    return 0
  fi
  # Collector recovered: clear the counter and, if we were degraded, announce it.
  if [ -f "$DEGRADED" ]; then
    rm -f "$DEGRADED"
    broadcast_all "$(jq -cn \
      --arg t "GitHub monitor reconnected — polling resumed." \
      '{ts:(now|todate),repo:null,key:null,type:"monitor_recovered",severity:"info",title:$t,url:null}')"
    log "recovered broadcast"
  fi
  echo 0 > "$FAILC"

  login="$(echo "$raw" | jq -r '.login // ""')"
  new="$(echo "$raw" | jq -c '{
    mine: ([.my_prs.items[] | {key: (.repo + "#" + (.number|tostring)),
      value: {repo, title, url, draft, ci, review, mergeable,
              merge_state, rtm: .ready_to_merge,
              ct: .conversation.total, cla: .conversation.last_author,
              nyr: .review_comments.needs_your_reply}}] | from_entries),
    rr: ([.review_requests.items[] | {key: (.repo + "#" + (.number|tostring)),
      value: {repo, title, url, draft, author}}] | from_entries),
    issues: ([.assigned_issues.items[] | {key: (.repo + "#" + (.number|tostring)),
      value: {repo, title, url}}] | from_entries),
    mentions: ([.mentions.items[] | {key: (.repo + "#" + (.number|tostring)),
      value: {repo, title, url, kind, author}}] | from_entries)
  }')"

  # Fold in watched-repo state only when the watch list is non-empty.
  if [ -n "$(watches_list)" ]; then
    # On a transient watched-fetch failure, carry the previous snapshot's
    # watched map forward — resetting it to {} would re-broadcast watch_started.
    if ! watched="$(collect_watched "$login")"; then
      watched="$(jq -c '.watched // {}' "$STATE" 2>/dev/null || echo '{}')"
      log "watched collection failed; carried previous watched state forward"
    fi
    new="$(echo "$new" | jq -c --argjson w "$watched" '. + {watched: $w}')"
  fi

  if [ ! -f "$STATE" ]; then
    printf '%s\n' "$new" > "$STATE.tmp.$$" && mv "$STATE.tmp.$$" "$STATE"
    local mine_n rr_n
    mine_n="$(echo "$raw" | jq '.my_prs.total')"
    rr_n="$(echo "$raw" | jq '.review_requests.total')"
    broadcast_all "$(jq -cn \
      --arg t "Monitoring started: baseline captured ($mine_n open PRs, $rr_n review requests). Changes will be reported from now on." \
      '{ts:(now|todate),repo:null,key:null,type:"monitor_started",severity:"info",title:$t,url:null}')"
    log "baseline captured ($mine_n PRs, $rr_n review requests)"
    return 0
  fi
  old="$(cat "$STATE")"
  # Carry across ticks: cif = CI failed with no SUCCESS since (a fix goes
  # FAILURE → PENDING → SUCCESS); a transient mergeable UNKNOWN keeps the last
  # known mergeable/rtm, so the flicker doesn't re-fire merge_conflict/ready_to_merge.
  new="$(jq -c --argjson old "$old" 'def f: . == "FAILURE" or . == "ERROR";
    .mine |= with_entries(($old.mine[.key] // {}) as $p | .value |=
      (.cif = ((.ci | f) or (.ci != "SUCCESS" and ($p.cif or ($p.ci | f))))
      | if .mergeable == "UNKNOWN" and $p.mergeable then .mergeable = $p.mergeable
        | .rtm = ((.draft | not) and .review == "APPROVED" and (.ci == "SUCCESS" or .ci == "NO_CHECKS") and .mergeable == "MERGEABLE")
        else . end))' <<< "$new")"
  events="$(jq -cn --argjson old "$old" --argjson new "$new" --arg login "$login" -f "$SCRIPT_DIR/diff_events.jq")"
  # Enrich fired events (disappeared -> merged/closed, name failing checks).
  resolved="$(echo "$events" | jq -c '.[]' | enrich_events | jq -cs '.')"
  n="$(echo "$resolved" | jq 'length')"
  if [ "$n" -gt 0 ]; then
    log "tick: $n event(s)"
    route_events "$resolved"
  fi
  printf '%s\n' "$new" > "$STATE.tmp.$$" && mv "$STATE.tmp.$$" "$STATE"
}

cmd_start() {
  need_tools
  local iv=""
  while [ $# -gt 0 ]; do case "$1" in --interval) iv="$2"; shift 2 ;; *) shift ;; esac; done
  if [ -n "$iv" ]; then
    [[ "$iv" =~ ^[1-9][0-9]*$ ]] && [ "$iv" -ge 30 ] || die_json bad_interval "Use whole seconds, at least 30"
    echo "$iv" > "$INTERVAL_FILE"
  fi
  # Check-and-start under an atomic mkdir lock, so parallel callers start one
  # daemon; a lock held past ~5s is presumed orphaned and broken once. Released
  # by hand, not by an EXIT trap: bash 3.2 skips one inside a pipeline element.
  local n=0 d=already_running
  until mkdir "$LOCK" 2>/dev/null; do [ $((n += 1)) -lt 50 ] || { rm -rf "$LOCK"; n=0; }; sleep 0.1; done
  if ! daemon_alive; then
    nohup bash "$0" _daemon >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    disown 2>/dev/null || true
    d=started
  fi
  rmdir "$LOCK" 2>/dev/null || true
  jq -cn --arg d "$d" --arg pid "$(cat "$PIDFILE")" --arg iv "$(interval)" \
    '{daemon:$d,pid:($pid|tonumber),interval_seconds:($iv|tonumber)}'
}

cmd__daemon() {
  echo $$ > "$PIDFILE"
  trap 'log "daemon exiting"; exit 0' TERM INT
  log "daemon started pid $$ interval $(interval)s"
  while :; do
    run_tick || log "tick error (status $?)"
    sleep "$(interval)"
  done
}

cmd_attach() {
  need_tools
  local scope="" mode="auto"
  while [ $# -gt 0 ]; do case "$1" in
    --repo) scope="$2"; mode="explicit"; shift 2 ;;
    --global) mode="global"; shift ;;
    *) shift ;;
  esac; done
  if [ "$mode" = "auto" ]; then scope="$(repo_from_cwd || true)"; fi
  if [ "$mode" = "global" ]; then scope=""; fi
  local id="s$(date +%s)$RANDOM"
  jq -cn --arg id "$id" --arg scope "$scope" \
    '{session:$id, scope:(if $scope=="" then null else $scope end), created:(now|todate)}' \
    > "$SESS/$id.json"
  : > "$QUEUES/$id.jsonl"
  local d=stopped; [ -e "$DIR/stopped" ] || d="$(cmd_start | jq -r .daemon)"
  jq -c --arg d "$d" '. + {daemon:$d}' "$SESS/$id.json"
}

cmd_poll() {
  local id="${1:-}"
  [ -n "$id" ] || die_json missing_session "Usage: monitor.sh poll <session-id>"
  [ -f "$SESS/$id.json" ] || mv "$SESS/$id.pruned" "$SESS/$id.json" 2>/dev/null \
    || die_json unknown_session "No such session (detached, or idle past 7d); attach again"
  touch "$SESS/$id.json"   # heartbeat: keeps this session's repo claim alive
  [ -e "$DIR/stopped" ] || daemon_alive || (cmd_start) >/dev/null 2>&1 || true
  local q="$QUEUES/$id.jsonl" tmp
  [ -s "$q" ] || return 0
  tmp="$q.draining.$$"
  mv "$q" "$tmp"           # atomic: concurrent daemon appends create a fresh queue
  cat "$tmp"
  rm -f "$tmp"
}

cmd_detach() {
  local id="${1:-}"
  [ -n "$id" ] || die_json missing_session "Usage: monitor.sh detach <session-id>"
  rm -f "$SESS/$id.json" "$SESS/$id.pruned" "$QUEUES/$id.jsonl"
  echo "{\"detached\":\"$id\"}"
}

cmd_history() {
  local since="24h" repo="" secs cutoff
  while [ $# -gt 0 ]; do case "$1" in
    --since) since="$2"; shift 2 ;;
    --repo)  repo="$2"; shift 2 ;;
    *) shift ;;
  esac; done
  secs="$(parse_duration "$since")" || die_json bad_since "Use Nm/Nh/Nd (e.g. 24h, 7d, 30m)"
  cutoff="$(( $(date +%s) - secs ))"
  [ -f "$HISTORY" ] || return 0
  jq -c --argjson cutoff "$cutoff" --arg repo "$repo" \
    'select((.ts | fromdate) >= $cutoff) | select($repo == "" or .repo == $repo)' \
    "$HISTORY" 2>/dev/null || true
}

cmd_mute() {
  local target="" dur="" until m secs
  while [ $# -gt 0 ]; do case "$1" in
    --for) dur="$2"; shift 2 ;;
    *) target="$1"; shift ;;
  esac; done
  [ -n "$target" ] || die_json missing_target "Usage: monitor.sh mute <O/R | O/R#N> [--for 4h|2d]"
  until=null
  if [ -n "$dur" ]; then
    secs="$(parse_duration "$dur")" || die_json bad_duration "Use Nm/Nh/Nd (e.g. 4h, 2d, 30m)"
    until="$(( $(date +%s) + secs ))"
  fi
  m="$(load_mutes | jq -c --arg t "$target" --argjson u "$until" \
    '[.[] | select(.target != $t)] + [{target:$t, until:$u}]')"
  printf '%s\n' "$m" > "$MUTES.tmp" && mv "$MUTES.tmp" "$MUTES"
  jq -cn --arg t "$target" --argjson u "$until" '{muted:$t, until:$u}'
}

cmd_unmute() {
  local target="${1:-}" m
  [ -n "$target" ] || die_json missing_target "Usage: monitor.sh unmute <target | --all>"
  if [ "$target" = "--all" ]; then
    printf '%s\n' '[]' > "$MUTES.tmp" && mv "$MUTES.tmp" "$MUTES"
    echo '{"unmuted":"all"}'; return 0
  fi
  m="$(load_mutes | jq -c --arg t "$target" '[.[] | select(.target != $t)]')"
  printf '%s\n' "$m" > "$MUTES.tmp" && mv "$MUTES.tmp" "$MUTES"
  jq -cn --arg t "$target" '{unmuted:$t}'
}

cmd_watch() {
  local r="${1:-}" w
  [[ "$r" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] || die_json bad_repo "Usage: monitor.sh watch <owner/repo>"
  w="$(watches_load | jq -c --arg r "$r" '(. + [$r]) | unique')"
  printf '%s\n' "$w" > "$WATCHES.tmp" && mv "$WATCHES.tmp" "$WATCHES"
  jq -cn --arg r "$r" '{watching:$r}'
}

cmd_unwatch() {
  local r="${1:-}" w
  [ -n "$r" ] || die_json bad_repo "Usage: monitor.sh unwatch <owner/repo>"
  w="$(watches_load | jq -c --arg r "$r" '[.[] | select(. != $r)]')"
  printf '%s\n' "$w" > "$WATCHES.tmp" && mv "$WATCHES.tmp" "$WATCHES"
  jq -cn --arg r "$r" '{unwatched:$r}'
}

cmd_status() {
  local running=false pid=null sessions="[]" sf id mt mutes watches hcount
  if daemon_alive; then running=true; pid="$(cat "$PIDFILE")"; fi
  for sf in "$SESS"/*.json; do
    [ -e "$sf" ] || continue
    id="$(basename "$sf" .json)"
    mt="$(stat -c %Y "$sf" 2>/dev/null || stat -f %m "$sf" 2>/dev/null || date +%s)"
    sessions="$(jq -c \
      --argjson s "$(jq -c . "$sf")" \
      --arg q "$( { wc -l < "$QUEUES/$id.jsonl"; } 2>/dev/null || echo 0)" \
      --arg age "$(( $(date +%s) - mt ))" \
      '. + [$s + {queued:($q|tonumber), seconds_since_poll:($age|tonumber)}]' <<< "$sessions")"
  done
  purge_mutes 2>/dev/null || true
  mutes="$(load_mutes)"
  watches="$(watches_load)"
  hcount="$( { wc -l < "$HISTORY"; } 2>/dev/null | tr -d '[:space:]' || echo 0)"
  [ -n "$hcount" ] || hcount=0
  jq -cn --argjson running "$running" --argjson pid "$pid" \
    --arg iv "$(interval)" --argjson sessions "$sessions" \
    --argjson mutes "$mutes" --argjson watches "$watches" --arg hcount "$hcount" \
    '{daemon:{running:$running,pid:$pid,interval_seconds:($iv|tonumber)},
      sessions:$sessions, mutes:$mutes, watches:$watches, history_lines:($hcount|tonumber)}'
}

cmd_hook_config() {
  command -v jq >/dev/null 2>&1 || die_json jq_not_installed "Install jq (apt install jq / brew install jq)"
  local hp="$SCRIPT_DIR/hook_poll.sh"
  jq -n --arg cmd "bash $hp" '{hooks:{
    UserPromptSubmit:[{hooks:[{type:"command",command:$cmd,timeout:20}]}],
    SessionEnd:[{hooks:[{type:"command",command:$cmd}]}]
  }}'
}

cmd_stop() {
  touch "$DIR/stopped"
  if daemon_alive; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo '{"daemon":"stopped"}'
  else
    rm -f "$PIDFILE"
    echo '{"daemon":"not_running"}'
  fi
}

case "${1:-}" in
  start)   shift; rm -f "$DIR/stopped"; cmd_start "$@" ;;
  attach)  shift; cmd_attach "$@" ;;
  poll)    shift; cmd_poll "$@" ;;
  detach)  shift; cmd_detach "$@" ;;
  status)  cmd_status ;;
  history) shift; cmd_history "$@" ;;
  mute)    shift; cmd_mute "$@" ;;
  unmute)  shift; cmd_unmute "$@" ;;
  watch)   shift; cmd_watch "$@" ;;
  unwatch) shift; cmd_unwatch "$@" ;;
  stop)    cmd_stop ;;
  hook-config) cmd_hook_config ;;
  tick)    run_tick ;;
  _daemon) cmd__daemon ;;
  *) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
