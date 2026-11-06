# GitHub review data: what lives where (GraphQL vs REST vs `gh` CLI)

> For the exhaustive, schema-generated list of every field on these types,
> see `graphql-fields-reference.md` in this directory.

A reference for humans and for Claude. The short version: **if you care about
review conversations and whether they're resolved, you must use GraphQL.**
The rest of this file explains exactly which pieces are GraphQL-only and how
to query them.

## The three comment surfaces on a PR

People say "PR comments" to mean three different things. GitHub models them
separately, and the split explains most of the API confusion:

1. **Reviews** — the submission events: Approve / Request changes / Comment,
   each with an optional summary body ("LGTM, two nits inline").
2. **Review threads** — the inline conversations anchored to code in the
   Files-changed tab. Each thread has a path, a line, comments, and a
   **Resolve conversation** state.
3. **Issue comments** — the plain comments on the Conversation tab, not
   attached to any code.

## Coverage table

| Data you want                                            | GraphQL                      | REST                                        | `gh pr view --json`                             |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------- | ----------------------------------------------- |
| Review submissions (state + summary body)                | ✓ `reviews`                  | ✓ `/pulls/N/reviews`                        | ✓ `reviews`, `latestReviews`                    |
| Inline review comment bodies                             | ✓ inside `reviewThreads`     | ✓ `/pulls/N/comments` (flat list)           | ✗ — its `comments` field is issue comments only |
| Comments grouped into threads                            | ✓ native                     | ⚠ reconstruct manually via `in_reply_to_id` | ✗ no field                                      |
| `isResolved` / `resolvedBy`                              | ✓                            | ✗ no concept of resolution                  | ✗                                               |
| `isOutdated` (code changed under the thread)             | ✓                            | ⚠ heuristic only: `position == null`        | ✗                                               |
| Thread node IDs (`PRRT_…`, required to resolve a thread) | ✓                            | ✗                                           | ✗                                               |
| Your own unsubmitted PENDING review                      | ✓ `reviews(states: PENDING)` | ✓ own pending appears in `/pulls/N/reviews` | ✗ not exposed                                   |
| Hidden/minimized comment flag                            | ✓ `isMinimized`              | ✗                                           | ✗                                               |

Two of the CLI gaps are long-standing, documented behavior: `gh pr view
--json comments` returns only Conversation-tab comments (cli/cli issue
#11477), and there is no `reviewThreads` field in its `--json` field list.
The officially sanctioned workaround is `gh api graphql` — which is what
this skill's scripts do.

One asymmetry worth knowing: **pending reviews are only ever visible to
their author**, on every API. So if a query returns a `PENDING` review, it's
yours — the classic "wrote ten comments, forgot to press Submit" trap. The
dashboard flags this as `your_pending_review`.

## Field cheat sheet

```text
PullRequest
├─ reviewDecision        APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
├─ reviews(first: N)                          ← surface 1
│    └─ nodes: author, state, body, submittedAt
│       state: PENDING | COMMENTED | APPROVED | CHANGES_REQUESTED | DISMISSED
└─ reviewThreads(first: N, after: $cursor)    ← surface 2 (GraphQL-only)
     ├─ totalCount, pageInfo { hasNextPage endCursor }
     └─ nodes:
        ├─ isResolved, isOutdated, resolvedBy { login }
        ├─ path, line, startLine, diffSide, subjectType (LINE | FILE)
        ├─ viewerCanResolve, viewerCanReply
        └─ comments(first: N) → nodes:
             author, body, createdAt, isMinimized, diffHunk, url
```

Interpretation tips:

- `line` is null for file-level threads (`subjectType: FILE`) and for some
  outdated threads — fall back to `startLine`, then to `path` alone.
- unresolved **and** outdated usually means "the code already changed,
  nobody clicked Resolve" — deprioritize these, don't nag about them.
- `reviewDecision` is the aggregate gate; individual thread state is the
  actionable detail underneath it.

## Copy-paste queries

Count unresolved threads on one PR:

```bash
gh api graphql -F owner=OWNER -F name=REPO -F number=123 -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { isResolved } }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
          | select(.isResolved | not)] | length'
```

Full conversation dump with pagination (what `scripts/pr_review_threads.sh`
wraps): include `$endCursor: String` in the query, request
`pageInfo { hasNextPage endCursor }`, and run with
`gh api graphql --paginate --slurp` so gh follows the cursor and returns all
pages as one JSON array. `reviewThreads` pages cap at 100 nodes, so any PR
with more threads silently truncates without this.

Resolving a thread (mutation — this skill never runs it unless the user
explicitly asks):

```bash
gh api graphql -F threadId=PRRT_xxx -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread { id isResolved }
  }
}'
```

## REST fallback (only if GraphQL is unavailable)

`GET /repos/O/R/pulls/N/comments` returns every inline comment as a flat
list; rebuild threads by grouping on `in_reply_to_id`. You still won't have
resolution state — there is no REST equivalent — so present the threads
without resolved/unresolved labels and say so.

## How the bundled scripts use this

- `scripts/gh_dashboard.sh` — per own-PR: `review_comments.unresolved`
  (surface 2), split into `needs_your_reply` (reviewer spoke last) vs
  `waiting_on_reviewer` (you spoke last), plus an `outdated` count; and a
  `conversation` `{total, last_author}` covering surface 3 (Conversation-tab
  comment count and who spoke last). Per review-request: `unresolved_threads`
  and `your_pending_review`.
- `scripts/pr_review_threads.sh <PR>` — the full drill-down: a top-level
  `conversation` array (surface 3, minimized filtered, 1500-char truncation)
  plus every thread with its comments, minimized comments filtered, resolved
  threads hidden unless `--all`. Each thread also carries a deep-link `url`
  and the `diff_hunk` (400-char) of the code its first comment anchors to.
