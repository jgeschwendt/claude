# diff_events.jq — turn two dashboard snapshots into notification events.
# Invoked as: jq -cn --argjson old ... --argjson new ... --arg login ... -f diff_events.jq
# Output: JSON array of {ts, repo, key, type, severity, title, url}
#   key = "owner/repo#N" for item-scoped events, null when there is no item
#         (release/watch-start). The mute feature matches on repo or key.

def ev($repo; $key; $type; $sev; $title; $url):
  {ts: (now | todate), repo: $repo, key: $key, type: $type, severity: $sev,
   title: $title, url: $url};

def failing($ci): $ci == "FAILURE" or $ci == "ERROR";

# Events for one of the user's own PRs present in both snapshots.
def mine_pair($key; $o; $n):
  [
    (if failing($n.ci) and (failing($o.ci) | not)
     then ev($n.repo; $key; "ci_failed"; "high";
             "\($key) \"\($n.title)\" — CI is now failing"; $n.url) else empty end),
    (if $n.ci == "SUCCESS" and ($o.cif or failing($o.ci))
     then ev($n.repo; $key; "ci_green"; "info";
             "\($key) \"\($n.title)\" — CI is green again"; $n.url) else empty end),
    (if $n.review == "APPROVED" and $o.review != "APPROVED"
     then ev($n.repo; $key; "approved"; "high";
             "\($key) \"\($n.title)\" — approved"; $n.url) else empty end),
    (if $n.review == "CHANGES_REQUESTED" and $o.review != "CHANGES_REQUESTED"
     then ev($n.repo; $key; "changes_requested"; "high";
             "\($key) \"\($n.title)\" — changes requested"; $n.url) else empty end),
    (if $n.mergeable == "CONFLICTING" and $o.mergeable != "CONFLICTING"
     then ev($n.repo; $key; "merge_conflict"; "high";
             "\($key) \"\($n.title)\" — now has merge conflicts"; $n.url) else empty end),
    (if ($n.nyr // 0) > ($o.nyr // 0)
     then ev($n.repo; $key; "new_review_comments"; "high";
             "\($key) \"\($n.title)\" — \(($n.nyr // 0) - ($o.nyr // 0)) new review comment(s) awaiting your reply";
             $n.url) else empty end),
    (if ($o | has("rtm")) and ($n.rtm == true) and (($o.rtm // false) == false)
     then ev($n.repo; $key; "ready_to_merge"; "high";
             "\($key) \"\($n.title)\" — approved, CI green, no conflicts: ready to merge"; $n.url) else empty end),
    (if ($o | has("merge_state")) and ($n.merge_state == "BEHIND") and ($o.merge_state != "BEHIND")
     then ev($n.repo; $key; "pr_behind"; "info";
             "\($key) \"\($n.title)\" — base branch has moved ahead; update your branch"; $n.url) else empty end),
    (if ($o | has("ct")) and (($n.ct // 0) > ($o.ct // 0)) and ($n.cla != null) and ($n.cla != $login)
     then ev($n.repo; $key; "new_conversation_comment"; "high";
             "\($key) \"\($n.title)\" — @\($n.cla) commented (\(($n.ct // 0) - ($o.ct // 0)) new)"; $n.url)
     else empty end)
  ];

# A newly-seen key in a watched repo -> repo_new_pr | repo_new_issue.
def watch_item($repo; $key; $iv):
  if $iv.kind == "pr"
  then ev($repo; $key; "repo_new_pr"; "info";
          "New PR in \($repo): \($key) \"\($iv.title)\" by @\($iv.author)"; $iv.url)
  else ev($repo; $key; "repo_new_issue"; "info";
          "New issue in \($repo): \($key) \"\($iv.title)\" by @\($iv.author)"; $iv.url)
  end;

(
  [ $new.mine | to_entries[] | .key as $k | .value as $n
    | if $old.mine[$k] == null
      then ev($n.repo; $k; "own_pr_tracked"; "info";
              "Now tracking your PR \($k) \"\($n.title)\""; $n.url)
      else mine_pair($k; $old.mine[$k]; $n)[]
      end ]
+ [ $old.mine | to_entries[] | .key as $k | .value as $o
    | select($new.mine[$k] == null)
    | ev($o.repo; $k; "pr_disappeared"; "high";
         "\($k) \"\($o.title)\" — no longer open"; $o.url) ]
+ [ $new.rr | to_entries[] | .key as $k | .value as $n
    | select($old.rr[$k] == null)
    | ev($n.repo; $k; "review_requested"; "high";
         "Review requested: \($k) \"\($n.title)\" by @\($n.author)\(if $n.draft then " (draft)" else "" end)";
         $n.url) ]
+ [ $new.rr | to_entries[] | .key as $k | .value as $n
    | select($old.rr[$k] != null)
    | $old.rr[$k] as $o
    | select(($o.draft == true) and ($n.draft == false))
    | ev($n.repo; $k; "draft_ready"; "high";
         "\($k) \"\($n.title)\" — now ready for your review"; $n.url) ]
+ [ $old.rr | to_entries[] | .key as $k | .value as $o
    | select($new.rr[$k] == null)
    | ev($o.repo; $k; "review_request_cleared"; "info";
         "Review request cleared: \($k) \"\($o.title)\""; $o.url) ]
+ [ $new.issues | to_entries[] | .key as $k | .value as $n
    | select($old.issues[$k] == null)
    | ev($n.repo; $k; "issue_assigned"; "high";
         "Issue assigned to you: \($k) \"\($n.title)\""; $n.url) ]
# mentions — guarded so an upgrade that first introduces the map doesn't storm.
+ (if ($old | has("mentions")) then
    [ $new.mentions | to_entries[] | .key as $k | .value as $n
      | select(($old.mentions // {})[$k] == null)
      | ev($n.repo; $k; "mentioned"; "high";
           "You were mentioned in \($n.kind | ascii_downcase) \($k) \"\($n.title)\" by @\($n.author)"; $n.url) ]
   else [] end)
# watched repos — first sighting of a repo baselines silently (one info notice).
+ (if ($new | has("watched")) then
    [ $new.watched | to_entries[] | .key as $repo | .value as $wn
      | (($old.watched // {})[$repo]) as $wo
      | if $wo == null
        then ev($repo; null; "watch_started"; "info"; "Now watching \($repo) activity"; null)
        else
          ( [ $wn.keys | to_entries[] | .key as $ik | .value as $iv
              | select(($wo.keys // {})[$ik] == null)
              | watch_item($repo; $ik; $iv) ]
          + [ if ($wn.release != null) and ($wn.release != $wo.release)
              then ev($repo; null; "release_published"; "info";
                      "\($repo) released \($wn.release)"; null)
              else empty end ] )[]
        end ]
   else [] end)
)
