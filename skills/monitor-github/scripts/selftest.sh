#!/usr/bin/env bash
# selftest.sh — offline self-test for the github-monitor scripts.
#
# No network, no real gh: it drives monitor.sh with a fixture collector
# (GITHUB_MONITOR_COLLECTOR), a scratch GITHUB_MONITOR_DIR, and a `gh` PATH
# shim for the post-diff enrichment lookups. diff_events.jq is unit-tested
# directly. Prints PASS/FAIL per case; exits non-zero if anything fails.
#
# Usage: bash selftest.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MON="$SCRIPT_DIR/monitor.sh"
JQ="$SCRIPT_DIR/diff_events.jq"

command -v jq >/dev/null 2>&1 || { echo "FAIL: jq not installed"; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ghmon-selftest.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PASSED=0; FAILED=0
pass() { echo "PASS: $1"; PASSED=$(( PASSED + 1 )); }
fail() { echo "FAIL: $1"; FAILED=$(( FAILED + 1 )); }

# ─── gh PATH shim (enrichment lookups only) ─────────────────────────────────
BIN="$TMP/bin"; mkdir -p "$BIN"
cat > "$BIN/gh" <<'SH'
#!/usr/bin/env bash
# Minimal gh stub. Only the calls monitor.sh makes during enrichment matter.
case "${1:-} ${2:-}" in
  "auth status") exit 0 ;;
  "pr view")     echo "${GH_PR_STATE:-MERGED}" ;;
  "pr checks")   echo "${GH_CHECKS:-[]}" ;;
  "api graphql") # watched-repo collector seam; GH_WATCHED_FAIL simulates an outage
    [ -n "${GH_WATCHED_FAIL:-}" ] && exit 1
    echo '{"data":{"prs":{"nodes":[]},"issues":{"nodes":[]}}}' ;;
  *) exit 0 ;;
esac
SH
chmod +x "$BIN/gh"
export PATH="$BIN:$PATH"

# ─── diff_events.jq unit harness ────────────────────────────────────────────
run_diff() { jq -cn --argjson old "$1" --argjson new "$2" --arg login "me" -f "$JQ" 2>/dev/null; }

t_event() { # desc old new type sev keyJSON
  local ev; ev="$(run_diff "$2" "$3")"
  if echo "$ev" | jq -e --arg t "$4" --arg s "$5" --argjson k "$6" \
      'any(.[]; .type==$t and .severity==$s and .key==$k)' >/dev/null 2>&1
  then pass "$1"; else fail "$1 :: $ev"; fi
}
t_absent() { # desc old new type
  local ev; ev="$(run_diff "$2" "$3")"
  if echo "$ev" | jq -e --arg t "$4" 'any(.[]; .type==$t)' >/dev/null 2>&1
  then fail "$1 :: unexpected $4 in $ev"; else pass "$1"; fi
}

base='{"mine":{},"rr":{},"issues":{},"mentions":{}}'
mv='{"repo":"o/r","title":"T","url":"u","draft":false,"ci":"SUCCESS","review":"NONE","mergeable":"MERGEABLE","merge_state":"CLEAN","rtm":false,"ct":0,"cla":null,"nyr":0}'
rv='{"repo":"o/r","title":"T","url":"u","draft":false,"author":"bob"}'

withmine() { jq -cn --arg k "$1" --argjson v "$2" '{mine:{($k):$v},rr:{},issues:{},mentions:{}}'; }
withrr()   { jq -cn --arg k "$1" --argjson v "$2" '{mine:{},rr:{($k):$v},issues:{},mentions:{}}'; }
withissue(){ jq -cn --arg k "$1" --argjson v "$2" '{mine:{},rr:{},issues:{($k):$v},mentions:{}}'; }
withment() { jq -cn --arg k "$1" --argjson v "$2" '{mine:{},rr:{},issues:{},mentions:{($k):$v}}'; }
withwatch(){ jq -cn --argjson w "$1" '{mine:{},rr:{},issues:{},mentions:{},watched:$w}'; }
o() { echo "$mv" | jq -c "$1"; }   # override the default mine value

echo "== diff_events.jq unit cases =="
t_event  "own_pr_tracked"       "$base"                      "$(withmine 'o/r#1' "$mv")"                 own_pr_tracked           info '"o/r#1"'
t_event  "ci_failed"            "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.ci="FAILURE"')")" ci_failed               high '"o/r#1"'
t_event  "ci_green"             "$(withmine 'o/r#1' "$(o '.ci="FAILURE"')")" "$(withmine 'o/r#1' "$mv")" ci_green                 info '"o/r#1"'
t_event  "approved"             "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.review="APPROVED"')")" approved            high '"o/r#1"'
t_event  "changes_requested"    "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.review="CHANGES_REQUESTED"')")" changes_requested high '"o/r#1"'
t_event  "merge_conflict"       "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.mergeable="CONFLICTING"')")" merge_conflict high '"o/r#1"'
t_event  "new_review_comments"  "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.nyr=2')")"       new_review_comments      high '"o/r#1"'
t_event  "ready_to_merge"       "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.rtm=true')")"    ready_to_merge           high '"o/r#1"'
t_event  "pr_behind"            "$(withmine 'o/r#1' "$mv")"  "$(withmine 'o/r#1' "$(o '.merge_state="BEHIND"')")" pr_behind        info '"o/r#1"'
t_event  "new_conversation_comment" "$(withmine 'o/r#1' "$mv")" "$(withmine 'o/r#1' "$(o '.ct=1|.cla="alice"')")" new_conversation_comment high '"o/r#1"'
t_absent "conversation comment by self is ignored" "$(withmine 'o/r#1' "$mv")" "$(withmine 'o/r#1' "$(o '.ct=1|.cla="me"')")" new_conversation_comment
t_event  "pr_disappeared"       "$(withmine 'o/r#1' "$mv")"  "$base"                                     pr_disappeared           high '"o/r#1"'
t_event  "review_requested"     "$base"                      "$(withrr 'o/r#2' "$rv")"                   review_requested         high '"o/r#2"'
t_event  "draft_ready"          "$(withrr 'o/r#2' "$(echo "$rv"|jq -c '.draft=true')")" "$(withrr 'o/r#2' "$rv")" draft_ready       high '"o/r#2"'
t_event  "review_request_cleared" "$(withrr 'o/r#2' "$rv")"  "$base"                                     review_request_cleared   info '"o/r#2"'
t_event  "issue_assigned"       "$base"                      "$(withissue 'o/r#3' '{"repo":"o/r","title":"T","url":"u"}')" issue_assigned high '"o/r#3"'
t_event  "mentioned"            "$base"                      "$(withment 'o/r#4' '{"repo":"o/r","title":"T","url":"u","kind":"Issue","author":"carol"}')" mentioned high '"o/r#4"'
t_event  "watch_started (first sighting)" "$(withwatch '{}')" "$(withwatch '{"o/r":{"keys":{},"release":null}}')" watch_started info 'null'
t_event  "watch_started (old state predates watching)" "$base" "$(withwatch '{"o/r":{"keys":{},"release":null}}')" watch_started info 'null'
t_absent "first sighting emits no repo_new_pr" "$(withwatch '{}')" "$(withwatch '{"o/r":{"keys":{"o/r#1":{"title":"T","url":"u","author":"z","kind":"pr"}},"release":null}}')" repo_new_pr
t_event  "repo_new_pr"          "$(withwatch '{"o/r":{"keys":{},"release":"v1"}}')" "$(withwatch '{"o/r":{"keys":{"o/r#1":{"title":"T","url":"u","author":"z","kind":"pr"}},"release":"v1"}}')" repo_new_pr info '"o/r#1"'
t_event  "repo_new_issue"       "$(withwatch '{"o/r":{"keys":{},"release":"v1"}}')" "$(withwatch '{"o/r":{"keys":{"o/r#7":{"title":"T","url":"u","author":"z","kind":"issue"}},"release":"v1"}}')" repo_new_issue info '"o/r#7"'
t_event  "release_published"    "$(withwatch '{"o/r":{"keys":{},"release":"v1"}}')" "$(withwatch '{"o/r":{"keys":{},"release":"v2"}}')" release_published info 'null'

# upgrade-storm guards: an old snapshot written before the field existed must not
# storm on the first post-upgrade diff — it should only populate the field.
t_absent "ready_to_merge suppressed when old lacks rtm"          "$(withmine 'o/r#1' "$(o 'del(.rtm)')")"         "$(withmine 'o/r#1' "$(o '.rtm=true')")"           ready_to_merge
t_absent "pr_behind suppressed when old lacks merge_state"       "$(withmine 'o/r#1' "$(o 'del(.merge_state)')")" "$(withmine 'o/r#1' "$(o '.merge_state="BEHIND"')")" pr_behind
t_absent "new_conversation_comment suppressed when old lacks ct" "$(withmine 'o/r#1' "$(o 'del(.ct)')")"          "$(withmine 'o/r#1' "$(o '.ct=1|.cla="alice"')")"  new_conversation_comment

# ─── integration harness (monitor.sh via fixture collector) ─────────────────
fresh_dir() {
  STATED="$(mktemp -d "$TMP/st.XXXXXX")"
  export GITHUB_MONITOR_DIR="$STATED"
  DASHF="$STATED/dash.json"
  export GITHUB_MONITOR_COLLECTOR="cat $DASHF"
  mkdir -p "$STATED/sessions" "$STATED/queues"
}
mk_session() { # id scope("" = global)
  jq -cn --arg id "$1" --arg s "$2" \
    '{session:$id, scope:(if $s=="" then null else $s end), created:(now|todate)}' \
    > "$STATED/sessions/$1.json"
  : > "$STATED/queues/$1.jsonl"
}
dash() { jq -cn --argjson items "$1" \
  '{login:"me", my_prs:{total:($items|length),items:$items},
    review_requests:{total:0,items:[]}, assigned_issues:{total:0,items:[]},
    mentions:{total:0,items:[]}}'; }
PRV='{"repo":"o/r","number":1,"title":"T","url":"u","draft":false,"ci":"SUCCESS","review":"NONE","mergeable":"MERGEABLE","merge_state":"CLEAN","in_merge_queue":false,"auto_merge":false,"base":"main","latest_reviews":[],"conversation":{"total":0,"last_author":null},"review_comments":{"needs_your_reply":0},"ready_to_merge":false}'
pritem() { echo "$PRV" | jq -c "$1"; }   # override a PR item
tick_items() { dash "$1" > "$DASHF"; bash "$MON" tick >/dev/null 2>&1; }
jq_has() { [ -f "$1" ] && jq -e --arg t "$2" --argjson k "$3" 'select(.type==$t and .key==$k)' "$1" >/dev/null 2>&1; }
qhas() { jq_has "$STATED/queues/$1.jsonl" "$2" "$3"; }
hhas() { jq_has "$STATED/history.jsonl" "$1" "$2"; }

echo "== routing =="
fresh_dir
mk_session sScoped "o/r"      # claims o/r
mk_session sGlobal ""
tick_items '[]'               # baseline
prR="$(pritem '.repo="o/r"|.number=10|.url="u10"')"
prX="$(pritem '.repo="o/x"|.number=20|.url="u20"')"
tick_items "$(jq -cn --argjson a "$prR" --argjson b "$prX" '[$a,$b]')"
if qhas sScoped own_pr_tracked '"o/r#10"'; then pass "scoped session receives its repo"; else fail "scoped session receives its repo"; fi
if qhas sGlobal own_pr_tracked '"o/r#10"'; then fail "global excluded from claimed repo"; else pass "global excluded from claimed repo"; fi
if qhas sGlobal own_pr_tracked '"o/x#20"'; then pass "global receives unclaimed repo"; else fail "global receives unclaimed repo"; fi
if qhas sScoped own_pr_tracked '"o/x#20"'; then fail "scoped session isolated to its repo"; else pass "scoped session isolated to its repo"; fi
# claim released on detach: remove scoped session, new o/r event now reaches global
bash "$MON" detach sScoped >/dev/null 2>&1
prR2="$(pritem '.repo="o/r"|.number=11|.url="u11"')"
tick_items "$(jq -cn --argjson a "$prR" --argjson b "$prX" --argjson c "$prR2" '[$a,$b,$c]')"
if qhas sGlobal own_pr_tracked '"o/r#11"'; then pass "claim released on detach"; else fail "claim released on detach"; fi

echo "== mute =="
fresh_dir
mk_session sG ""
tick_items '[]'
printf '%s\n' '[{"target":"o/r","until":null}]' > "$STATED/mutes.json"
prR="$(pritem '.repo="o/r"|.number=100|.url="u100"')"
prX="$(pritem '.repo="o/x"|.number=200|.url="u200"')"
tick_items "$(jq -cn --argjson a "$prR" --argjson b "$prX" '[$a,$b]')"
if qhas sG own_pr_tracked '"o/r#100"'; then fail "repo mute drops from queue"; else pass "repo mute drops from queue"; fi
if hhas own_pr_tracked '"o/r#100"'; then fail "repo mute drops from history"; else pass "repo mute drops from history"; fi
if qhas sG own_pr_tracked '"o/x#200"'; then pass "non-muted repo still delivered"; else fail "non-muted repo still delivered"; fi
# item-level mute
printf '%s\n' '[{"target":"o/x#201","until":null}]' > "$STATED/mutes.json"
pr1="$(pritem '.repo="o/x"|.number=201|.url="u201"')"
pr2="$(pritem '.repo="o/x"|.number=202|.url="u202"')"
tick_items "$(jq -cn --argjson a "$prR" --argjson b "$prX" --argjson c "$pr1" --argjson d "$pr2" '[$a,$b,$c,$d]')"
if qhas sG own_pr_tracked '"o/x#201"'; then fail "item mute drops that item"; else pass "item mute drops that item"; fi
if qhas sG own_pr_tracked '"o/x#202"'; then pass "sibling item still delivered"; else fail "sibling item still delivered"; fi
# expiry honored: an already-expired mute is purged, event delivered
printf '%s\n' '[{"target":"o/r","until":1}]' > "$STATED/mutes.json"
pr3="$(pritem '.repo="o/r"|.number=103|.url="u103"')"
tick_items "$(jq -cn --argjson a "$prR" --argjson b "$prX" --argjson c "$pr1" --argjson d "$pr2" --argjson e "$pr3" '[$a,$b,$c,$d,$e]')"
if qhas sG own_pr_tracked '"o/r#103"'; then pass "expired mute is ignored"; else fail "expired mute is ignored"; fi

echo "== history =="
fresh_dir
mk_session sG ""
tick_items '[]'
prR="$(pritem '.repo="o/r"|.number=300|.url="u300"')"
tick_items "$(jq -cn --argjson a "$prR" '[$a]')"
if hhas own_pr_tracked '"o/r#300"'; then pass "history append on route"; else fail "history append on route"; fi
# rotation: pre-fill past the 5000 cap, then one routed event triggers truncation
yes '{"ts":"2020-01-01T00:00:00Z","repo":"o/r","key":null,"type":"x","severity":"info","title":"x","url":null}' 2>/dev/null | head -5000 > "$STATED/history.jsonl"
prR2="$(pritem '.repo="o/r"|.number=301|.url="u301"')"
tick_items "$(jq -cn --argjson a "$prR" --argjson b "$prR2" '[$a,$b]')"
hn="$(wc -l < "$STATED/history.jsonl" | tr -d '[:space:]')"
if [ "$hn" = "2500" ]; then pass "history rotates to 2500"; else fail "history rotates to 2500 (got $hn)"; fi
# --since filtering
now_ts="$(date -u +%FT%TZ)"
{ printf '%s\n' '{"ts":"2000-01-01T00:00:00Z","repo":"o/r","key":null,"type":"stale","severity":"info","title":"stale","url":null}'
  printf '%s\n' "{\"ts\":\"$now_ts\",\"repo\":\"o/r\",\"key\":null,\"type\":\"fresh\",\"severity\":\"info\",\"title\":\"fresh\",\"url\":null}"; } > "$STATED/history.jsonl"
out="$(bash "$MON" history --since 24h 2>/dev/null)"
if echo "$out" | jq -e 'select(.type=="fresh")' >/dev/null 2>&1 && ! echo "$out" | jq -e 'select(.type=="stale")' >/dev/null 2>&1
then pass "history --since filters by cutoff"; else fail "history --since filters by cutoff :: $out"; fi
outr="$(bash "$MON" history --since 24h --repo o/none 2>/dev/null)"
if [ -z "$outr" ]; then pass "history --repo filters"; else fail "history --repo filters :: $outr"; fi

echo "== degraded / recovered =="
fresh_dir
mk_session sG ""
export GITHUB_MONITOR_COLLECTOR="false"
bash "$MON" tick >/dev/null 2>&1
bash "$MON" tick >/dev/null 2>&1
bash "$MON" tick >/dev/null 2>&1
dn="$(jq -c 'select(.type=="monitor_degraded")' "$STATED/queues/sG.jsonl" 2>/dev/null | grep -c . || true)"
if [ "$dn" = "1" ]; then pass "3 failures => exactly one monitor_degraded"; else fail "monitor_degraded count (got $dn)"; fi
bash "$MON" tick >/dev/null 2>&1     # 4th failure: no re-spam
dn2="$(jq -c 'select(.type=="monitor_degraded")' "$STATED/queues/sG.jsonl" 2>/dev/null | grep -c . || true)"
if [ "$dn2" = "1" ]; then pass "no degraded re-spam while failing"; else fail "degraded re-spam (got $dn2)"; fi
export GITHUB_MONITOR_COLLECTOR="cat $DASHF"
tick_items '[]'                       # first success
if qhas sG monitor_recovered 'null'; then pass "recovery broadcasts monitor_recovered"; else fail "recovery broadcasts monitor_recovered"; fi

echo "== enrichment (gh shim) =="
fresh_dir
mk_session sG ""
prR="$(pritem '.repo="o/r"|.number=400|.url="u400"')"
tick_items "$(jq -cn --argjson a "$prR" '[$a]')"       # baseline tracks it
export GH_PR_STATE=MERGED
tick_items '[]'                                          # PR gone -> disappeared -> merged
if qhas sG pr_merged '"o/r#400"'; then pass "pr_disappeared resolves to pr_merged"; else fail "pr_disappeared resolves to pr_merged"; fi
unset GH_PR_STATE
# ci_failed enrichment names the failing checks
fresh_dir
mk_session sG ""
prR="$(pritem '.repo="o/r"|.number=401|.url="u401"|.ci="SUCCESS"')"
tick_items "$(jq -cn --argjson a "$prR" '[$a]')"
export GH_CHECKS='[{"name":"test","state":"FAILURE"},{"name":"lint","state":"FAILURE"},{"name":"ok","state":"SUCCESS"}]'
prF="$(pritem '.repo="o/r"|.number=401|.url="u401"|.ci="FAILURE"')"
tick_items "$(jq -cn --argjson a "$prF" '[$a]')"
if jq -e 'select(.type=="ci_failed" and (.title | test("test")))' "$STATED/queues/sG.jsonl" >/dev/null 2>&1
then pass "ci_failed enriched with check names"; else fail "ci_failed enriched with check names"; fi
unset GH_CHECKS

echo "== watched carry-forward =="
fresh_dir
mk_session sG ""
printf '%s\n' '["o/r"]' > "$STATED/watches.json"   # watch a repo so watched state is collected
tick_items '[]'                                     # baseline captures the watched map for o/r
if jq -e '.watched["o/r"]' "$STATED/state.json" >/dev/null 2>&1
then pass "baseline captures watched state"; else fail "baseline captures watched state"; fi
# transient watched-fetch outage: tick must not abort and must carry watched forward
export GH_WATCHED_FAIL=1
prW="$(pritem '.repo="o/w"|.number=50|.url="u50"')"
tick_items "$(jq -cn --argjson a "$prW" '[$a]')"
unset GH_WATCHED_FAIL
if jq -e '.watched["o/r"]' "$STATED/state.json" >/dev/null 2>&1
then pass "failed watched fetch carries watched map forward"; else fail "failed watched fetch carries watched map forward"; fi
if qhas sG own_pr_tracked '"o/w#50"'; then pass "tick survives watched-fetch failure"; else fail "tick survives watched-fetch failure"; fi
# recovery tick: watched fetch succeeds again, no spurious watch_started re-broadcast
tick_items "$(jq -cn --argjson a "$prW" '[$a]')"
if qhas sG watch_started 'null'; then fail "no watch_started re-broadcast after recovery"; else pass "no watch_started re-broadcast after recovery"; fi

echo "== concurrent attach =="
fresh_dir
dash '[]' > "$DASHF"; echo 3600 > "$STATED/interval"
for _ in 1 2 3 4; do bash "$MON" attach --global >/dev/null 2>&1 & done; wait; sleep 1
pids="$(sed -n 's/.*daemon started pid \([0-9]*\).*/\1/p' "$STATED/daemon.log")"
kill $pids 2>/dev/null
if [ "$(echo "$pids" | grep -c .)" = 1 ]; then pass "parallel attaches start one daemon"; else fail "parallel attaches start one daemon (pids: $(echo $pids))"; fi

echo
echo "== summary: $PASSED passed, $FAILED failed =="
[ "$FAILED" -eq 0 ]
