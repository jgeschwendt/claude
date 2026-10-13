---
name: monitor-github
description: Monitor the user's GitHub and triage what needs their attention - their open pull requests (CI status, review decisions, merge conflicts, unresolved review comments), PRs waiting on their review (including unsubmitted pending reviews), and issues assigned to them. Includes a background daemon for continuous, repo-scoped notifications. Use this whenever the user asks to check their GitHub, asks "what's waiting on me", "any PRs I need to review?", "how are my PRs doing?", "did CI pass?", "any comments on my PR?", wants to watch/monitor a repo or be notified of GitHub changes, asks "anything new?" while monitoring, wants a GitHub status/dashboard/standup summary, asks "was I mentioned anywhere?", asks what happened while they were away/overnight/on GitHub today (catch-up/standup), wants to stop notifications about something ("stop telling me about X"), wants to watch a repo's activity or releases ("tell me when o/r releases", "watch new issues in o/r"), or mentions review requests, review feedback, unresolved comments, or their open PRs - even if they never say the word "GitHub".
---

# GitHub Monitor

Answer one question fast: **what on GitHub needs the user's attention right now?**
Two modes: an on-demand dashboard snapshot, and a background daemon that turns
snapshot _changes_ into notifications, scoped per conversation.

Everything uses the GraphQL API (`gh api graphql`) rather than
`gh pr view --json` or REST, because review conversations - thread grouping,
`isResolved`, `isOutdated`, unsubmitted pending reviews - only exist in
GraphQL (unverified 2026-07-30 · not probed this run).
`references/review-data-guide.md` explains what lives where;
`references/graphql-fields-reference.md` is the exhaustive, schema-generated
list of every field on every relevant type (consult it before claiming a data
point doesn't exist, or when extending the queries);
`references/monitoring-guide.md` documents the daemon architecture, routing
rule, and hook delivery in depth.

## Snapshot mode

Run the bundled collector (`$SKILL` = `~/.claude/skills/monitor-github` — Bash runs from the project cwd, so always use full paths):

```bash
bash $SKILL/scripts/gh_dashboard.sh        # up to 20 items per section
bash $SKILL/scripts/gh_dashboard.sh 50     # raise the cap (max 50)
```

Two API calls (~2s), one JSON object out: `my_prs`, `review_requests`
(sorted longest-waiting first, so overdue reviews never fall off the end),
`assigned_issues`, and `mentions`. Requires the `gh` CLI, authenticated, plus
`jq` for the daemon. On failure it prints `{"error": ..., "hint": ...}` - relay
the hint (usually `gh auth login`). GitHub Enterprise: prefix commands with
`GH_HOST=github.mycorp.com`.

### Field glossary

| Field                                   | Values / shape                                                            | Meaning                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review`                                | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, `NONE`                | `NONE` = repo doesn't require review                                                                                                                                                                                    |
| `mergeable`                             | `MERGEABLE`, `CONFLICTING`, `UNKNOWN`                                     | `UNKNOWN` = GitHub still computing (common right after a push); treat as fine                                                                                                                                           |
| `ci`                                    | `SUCCESS`, `FAILURE`, `ERROR`, `PENDING`, `EXPECTED`, `NO_CHECKS`         | Rollup of all checks on the latest commit                                                                                                                                                                               |
| `review_comments` (own PRs)             | `{unresolved, needs_your_reply, waiting_on_reviewer, outdated}`           | Unresolved inline threads split by who spoke last: `needs_your_reply` = reviewer waiting on the user; `waiting_on_reviewer` = user replied, not resolved yet. `outdated` = code already changed under it - deprioritize |
| `merge_state` (own PRs)                 | `BEHIND`, `BLOCKED`, `CLEAN`, `DIRTY`, `HAS_HOOKS`, `UNSTABLE`, `UNKNOWN` | GitHub's `mergeStateStatus`. `BEHIND` = base moved ahead, update the branch; `CLEAN`/`HAS_HOOKS` = green                                                                                                                |
| `in_merge_queue` (own PRs)              | bool                                                                      | PR sits in the repo's merge queue - it will land itself, don't merge manually                                                                                                                                           |
| `auto_merge` (own PRs)                  | bool                                                                      | Auto-merge is armed - GitHub merges it automatically once green                                                                                                                                                         |
| `ready_to_merge` (own PRs)              | bool                                                                      | Computed: not draft **and** `APPROVED` **and** CI `SUCCESS`/`NO_CHECKS` **and** `MERGEABLE`. The "go press merge" signal                                                                                                |
| `base` (own PRs)                        | branch name                                                               | Base branch the PR targets                                                                                                                                                                                              |
| `latest_reviews` (own PRs)              | `[{author, state}]`                                                       | Latest submitted review per reviewer - use to name who approved / requested changes                                                                                                                                     |
| `conversation` (own PRs)                | `{total, last_author}`                                                    | Conversation-tab (issue) comment count and who spoke last - not inline review threads                                                                                                                                   |
| `labels` (assigned issues)              | `[name]`                                                                  | Up to 5 label names on the issue                                                                                                                                                                                        |
| `mentions` section                      | `[{repo, number, title, url, kind, author, updatedAt}]`                   | Open Issues+PRs mentioning the user (not self-authored, last 30 days). `kind` = `Issue`/`PullRequest`                                                                                                                   |
| `unresolved_threads` (review requests)  | count                                                                     | Open discussion already on a PR the user was asked to review                                                                                                                                                            |
| `your_pending_review` (review requests) | bool                                                                      | The user started a review and **never submitted it** - invisible to everyone else until they do                                                                                                                         |
| `total` vs `items`                      | -                                                                         | If `total` > items shown, say so ("showing 20 of 34") and offer a higher limit                                                                                                                                          |

Thread counts cover the first 50 threads per PR. For complete depth on one PR,
the drill-down in § Follow-ups paginates.

## Triage

Sort every item into three buckets; the user should be able to read only the
first section and know what to do next.

**● Needs your action**

Rows ordered blocked-on-you first — others waiting on the user, then the user's
own blockers, then mentions. Order encodes triage priority; exempt from
alpha-sort. (since 2026-07-30 · F5, ordering principle confirmed by user)

| Signal                                                                  | Suggested action                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `your_pending_review` = true                                            | Submit (or discard) the unsubmitted review - flag loudly; the author is blocked on comments they cannot see |
| Review requested from you (not draft)                                   | Review - lead with the longest-waiting; include size and author                                             |
| Your PR: `review_comments.needs_your_reply` > 0                         | Address/reply to N comments (note how many are `outdated`)                                                  |
| Your PR: `ready_to_merge` = true                                        | Merge it                                                                                                    |
| Your PR: `merge_state=BEHIND` on an otherwise-green PR                  | Update the branch (one click, or `gh pr update-branch <url>`)                                               |
| Your PR: `ci=FAILURE` or `ERROR`                                        | Fix CI                                                                                                      |
| Your PR: `mergeable=CONFLICTING`                                        | Rebase / resolve conflicts                                                                                  |
| Your PR: `review=CHANGES_REQUESTED`, nothing left in `needs_your_reply` | Re-request review - feedback addressed but the gate is still down                                           |
| Recent `mentions` item (≤ 2 days)                                       | Respond to the mention - name the author and thread                                                         |

When reporting a PR's review state, name who approved / requested changes from
`latest_reviews` (e.g. "approved by @sara, changes requested by @tom").

**◐ Waiting on others** - open non-draft PRs matching no ● Needs your action
row (review pending, CI running, `waiting_on_reviewer` threads). Untouched > 7
days → flag ⚠ and offer to draft a nudge. `auto_merge` = true → "auto-merge
armed, will land itself when green" (do **not** tell the user to merge
manually). `in_merge_queue` = true → "in merge queue".

**○ FYI** - drafts, draft review requests, assigned issues, older `mentions`
(> 2 days). One line each.

A PR can match several rows - report the most actionable problem first.

## Reporting

Compact and scannable; renders in a terminal. Lead with the needs-action
count, link every item, humanize timestamps ("waiting 5d"). Example shape:

```
## GitHub - octocat

● Needs you (3)
1. ⚠ Unsubmitted review on acme/api#377 "Retry logic" - pending comments nobody can see
2. Review acme/web#88 "Auth refactor" - @sara, waiting 8d ⚠, +310 -42 in 12 files, CI ✓
3. Reply to 3 comments on acme/api#412 "Add rate limiting" (1 outdated)

◐ Waiting on others (1)
- acme/api#401 "Retry queue" - you answered 2 threads, awaiting @tom (2d)

○ FYI: 1 draft · 2 assigned issues
```

Close with a one-line recommendation when one item is clearly most urgent.
All clear → one friendly line, no table. Never dump raw JSON.

## Continuous monitoring (daemon)

When the user wants to _watch_ rather than check once ("monitor this repo",
"tell me when CI finishes", "let me know if anyone requests a review"):

```bash
bash $SKILL/scripts/monitor.sh attach            # in a repo clone → scoped to that repo
bash $SKILL/scripts/monitor.sh attach --global   # everything (minus claimed repos)
bash $SKILL/scripts/monitor.sh attach --repo o/r # explicit scope
```

`attach` starts the daemon if needed and prints `{"session": "s…", "scope": …}`.
**Remember the session id for the rest of the conversation**, and tell the
user their scope in plain words.

**The routing rule** (this is the contract - state it accurately):

- A session attached from inside a repo clone is scoped to that repo and
  receives only that repo's notifications.
- A session attached with no git context is global: it receives every
  notification **except** those for repos currently claimed by another live
  repo-scoped session. So "watch everything else here, this repo is handled
  in the other conversation" works with zero configuration.
- Claims release on `detach` or after 2h without polling (stale sessions are
  pruned so a dead conversation can't silently eat notifications forever).

**Delivering events** (all three modes below): when events land, surface
`high` severity briefly but prominently, then continue with the user's actual
request; relay `info` in passing.

**Delivery, Monitor mode (recommended in-session — push, no settings.json
changes).** After `attach`, arm a persistent Monitor so events stream into the
conversation as notifications while you keep working:

```
Monitor(
  command: "while :; do bash $SKILL/scripts/monitor.sh poll <session-id> 2>/dev/null \
    | jq --unbuffered -r '\"[\" + (.severity|ascii_upcase) + \"] \" + .title + (if .url then \" — \" + .url else \"\" end)'; \
    sleep 60; done",
  description: "github events (<scope>)", persistent: true)
```

Polling doubles as the claim heartbeat. If the user has likely stepped away,
also send a PushNotification (one line, ≤200 chars, lead with the actionable
fact — the tool self-suppresses when they're active). On "stop watching":
TaskStop the monitor, then `detach`.

**Delivery, hook mode (always-on across sessions).** Claude Code injects a
hook's stdout as conversation context on `UserPromptSubmit` and `SessionStart`
(verified 2026-07-15 · monitoring-guide.md § Push delivery: how the Claude Code hook works),
so the bundled `scripts/hook_poll.sh` makes events arrive automatically with
every user message - no asking. Setup (with the user's permission):

```bash
bash $SKILL/scripts/monitor.sh hook-config   # prints the settings.json snippet
```

Merge that into `~/.claude/settings.json` (UserPromptSubmit delivers;
SessionEnd is optional instant cleanup - TTL pruning covers it anyway).
Claude Code snapshots hooks at session start, so the hook takes effect in new
sessions - the user can review it with `/hooks`
(verified 2026-07-15 · monitoring-guide.md § Push delivery: how the Claude Code hook works).
Once installed, every conversation auto-attaches on its first message, scoped
by its cwd under **The routing rule**, and pending events appear as
`[github-monitor]` context lines. Don't also attach manually or re-poll - the
hook already did both. The hook always exits 0 - a non-zero UserPromptSubmit
hook can block the user's prompt
(unverified 2026-07-30 · not probed this run) - and prints nothing when there's
no news.

**Delivery, manual mode (no hook installed).** Run:

```bash
bash $SKILL/scripts/monitor.sh poll <session-id>
```

when the user asks "anything new?", and opportunistically between long tasks.
Empty output = no news (say so briefly only if asked). Each event is a JSON
line: `{ts, repo, key, type, severity, title, url}` - `key` is `"o/r#N"` (or
null for repo-wide events like releases).

| Event type                                    | Sev       | Meaning                                                                                   |
| --------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `review_requested` / `review_request_cleared` | high/info | Someone wants (no longer wants) the user's review                                         |
| `draft_ready`                                 | high      | A PR awaiting the user's review left draft - now reviewable                               |
| `ci_failed` / `ci_green`                      | high/info | Checks on their PR started failing / recovered (`ci_failed` names up to 3 failing checks) |
| `changes_requested` / `approved`              | high      | Review decision changed on their PR                                                       |
| `merge_conflict`                              | high      | Their PR now conflicts with base                                                          |
| `pr_behind`                                   | info      | Base branch moved ahead of their PR - update the branch                                   |
| `ready_to_merge`                              | high      | Their PR just went approved + green + mergeable: the "go press merge" moment              |
| `new_review_comments`                         | high      | Unresolved comments awaiting their reply increased                                        |
| `new_conversation_comment`                    | high      | Someone commented on the Conversation tab of their PR (commenter named)                   |
| `mentioned`                                   | high      | The user was mentioned in an issue/PR by someone else                                     |
| `pr_merged` / `pr_closed`                     | high      | Their PR left the open set (distinguished by lookup; merged shows "merged ✓")             |
| `watch_started`                               | info      | A watched repo baselined (first sighting, silent otherwise)                               |
| `repo_new_pr` / `repo_new_issue`              | info      | New PR / issue by someone else in a watched repo                                          |
| `release_published`                           | info      | A watched repo published a new latest release                                             |
| `monitor_degraded` / `monitor_recovered`      | high/info | The daemon lost / regained its connection to GitHub                                       |
| `issue_assigned`                              | high      | An issue was assigned to you                                                              |
| `own_pr_tracked`, `monitor_started`           | info      | Informational bookkeeping                                                                 |

Lifecycle: `detach <id>` when the user says stop watching (the daemon keeps
serving other sessions); `stop` kills the daemon; `status` shows pid,
interval, sessions, plus active mutes, watches, and `history_lines`;
`start --interval 60` tunes the poll cadence (default 120s ≈ 2 cheap GraphQL
calls per tick - rate limits are a non-issue). `tick` runs one cycle in the
foreground for debugging. State lives in `~/.local/state/github-monitor`
(override: `GITHUB_MONITOR_DIR`). Always tell the user when a daemon is left
running and how to stop it.

**Catch-up / standup** ("what happened while I was away/overnight?", "GitHub
today?"): reach for `history`, not a fresh snapshot - it replays every
_delivered_ event from the rolling log (muted events never entered it).

```bash
bash $SKILL/scripts/monitor.sh history                 # last 24h (default)
bash $SKILL/scripts/monitor.sh history --since 7d       # Nm/Nh/Nd window
bash $SKILL/scripts/monitor.sh history --repo acme/api  # one repo
```

Log caps at ~5000 lines and rotates to the newest 2500.

**Muting** ("stop telling me about X"): suppress a repo or a single item; muted
events are dropped entirely - not delivered, not in history.

```bash
bash $SKILL/scripts/monitor.sh mute acme/api            # until unmuted
bash $SKILL/scripts/monitor.sh mute acme/api#88 --for 4h # 4h/2d window
bash $SKILL/scripts/monitor.sh unmute acme/api          # or: unmute --all
```

**Watching repo activity** ("watch new issues in o/r", "tell me when o/r
releases") - opt-in and separate from scope claims: it reports new PRs/issues
by _others_ (info) and latest-release changes for a repo you don't own work in.

```bash
bash $SKILL/scripts/monitor.sh watch acme/infra
bash $SKILL/scripts/monitor.sh unwatch acme/infra
```

Watching adds one GraphQL query per tick for the whole watch list plus one
REST (latest-release) call per watched repo. `watch` does **not**
start the daemon (only `attach`/`start` do) - watches fire only while the
daemon runs; the first sighting baselines silently with one "Now watching"
notice. Use this when the user says "watch this repo's issues/releases" rather
than "watch my stuff" (that's `attach`).

**Degraded mode:** 3 consecutive failed polls broadcast one `monitor_degraded`
event (check `gh auth status`); recovery broadcasts `monitor_recovered`.

## Follow-ups

**Review conversation detail** ("what are the comments on #412?") - use the
bundled drill-down, which fetches full threads via paginated GraphQL:

```bash
bash $SKILL/scripts/pr_review_threads.sh https://github.com/owner/repo/pull/412
bash $SKILL/scripts/pr_review_threads.sh owner/repo#412 --all     # include resolved
```

It returns review submissions, the Conversation-tab comments (top-level
`conversation`), and every unresolved thread with path, line, the complete
comment chain, a deep-link `url`, and the `diff_hunk` the thread anchors to
(minimized comments filtered, long bodies truncated) - so "what code is this
thread about?" needs no extra fetch. Summarize by theme unless asked
otherwise. Do **not** use `gh pr view --comments` for this - it only returns
Conversation-tab comments and misses inline review threads entirely.

Other drill-downs:

```bash
gh pr checks <url>                          # which checks failed
gh run view <run-id> --log-failed -R o/r    # CI failure logs
gh pr diff <url>                            # the actual changes
gh pr checkout <number> -R owner/repo       # work on it locally (needs a clone)
```

Other slices on request:

```bash
gh search prs --reviewed-by=@me --state=open --limit 20 \
  --json title,url,repository,updatedAt                    # PRs you reviewed
gh search prs --mentions=@me --state=open --limit 20 \
  --json title,url,repository,updatedAt                    # mentions
gh api notifications --jq '.[] | {reason, title: .subject.title, repo: .repository.full_name}'
```

**Stay read-only by default.** Every write to GitHub — merging, commenting,
approving, resolving threads, closing, and any other mutation (labels,
assignees, titles, re-requests) — requires an explicit user instruction. When
asked: `gh pr merge <url> --rebase`, `gh pr comment <url> --body "..."`,
`gh pr review <url> --approve`, and the `resolveReviewThread` mutation (see
`references/review-data-guide.md`).

## Fallback

If the bundled scripts are unavailable, plain search gives the lists (no
CI/merge/thread data):

```bash
gh search prs --author=@me --state=open --limit 20 \
  --json number,title,repository,url,updatedAt,isDraft
gh search prs --review-requested=@me --state=open --limit 20 \
  --json number,title,repository,url,updatedAt,author,isDraft
```

Per-PR detail: `gh pr view <url> --json statusCheckRollup,reviewDecision,mergeable`.
Review-thread state has no CLI or REST equivalent
(unverified 2026-07-30 · not probed this run) - use the raw GraphQL from
`references/review-data-guide.md`. Missing repos in results usually means token
scope or SSO authorization: check `gh auth status`.
