#!/usr/bin/env bash
# pr_review_threads.sh — dump the full review conversation for one PR.
#
# This data is GraphQL-only: review-thread grouping, isResolved, isOutdated,
# and resolvedBy do not exist in the REST API or in `gh pr view --json`
# (whose `comments` field omits inline review comments entirely).
#
# Usage:
#   pr_review_threads.sh https://github.com/OWNER/REPO/pull/123
#   pr_review_threads.sh OWNER/REPO#123
#   pr_review_threads.sh OWNER/REPO 123
#   ... add --all to include resolved threads (default: unresolved only)
#
# Output: one JSON object — PR header, review submissions, Conversation-tab
#         comments, and threads with every non-minimized comment (bodies
#         truncated at 1500 chars). Each thread also carries a deep-link url and
#         the diff_hunk its first comment anchors to (truncated at 400 chars).
# Paginates automatically, so large PRs are covered completely.

set -euo pipefail

ALL=false
ARGS=()
for a in "$@"; do
  case "$a" in
    --all) ALL=true ;;
    *) ARGS+=("$a") ;;
  esac
done

usage_err() {
  echo '{"error":"bad_args","hint":"Pass a PR as URL, OWNER/REPO#NUM, or OWNER/REPO NUM (optionally --all)"}' >&2
  exit 1
}

[ "${#ARGS[@]}" -ge 1 ] || usage_err

if [[ "${ARGS[0]}" =~ ^https?://[^/]+/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"; REPO="${BASH_REMATCH[2]}"; NUMBER="${BASH_REMATCH[3]}"
elif [[ "${ARGS[0]}" =~ ^([^/#[:space:]]+)/([^/#[:space:]]+)#([0-9]+)$ ]]; then
  OWNER="${BASH_REMATCH[1]}"; REPO="${BASH_REMATCH[2]}"; NUMBER="${BASH_REMATCH[3]}"
elif [ "${#ARGS[@]}" -ge 2 ] && [[ "${ARGS[1]}" =~ ^[0-9]+$ ]] && [[ "${ARGS[0]}" =~ ^([^/#[:space:]]+)/([^/#[:space:]]+)$ ]]; then
  OWNER="${BASH_REMATCH[1]}"; REPO="${BASH_REMATCH[2]}"; NUMBER="${ARGS[1]}"
else
  usage_err
fi

if ! gh auth status >/dev/null 2>&1; then
  echo '{"error":"not_authenticated","hint":"Run: gh auth login"}' >&2
  exit 1
fi

QUERY='
query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title url reviewDecision
      reviews(first: 30) {
        nodes { author { login } state submittedAt body }
      }
      comments(first: 30) {
        nodes { author { login } createdAt isMinimized body }
      }
      reviewThreads(first: 50, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        totalCount
        nodes {
          isResolved isOutdated path startLine line subjectType
          resolvedBy { login }
          comments(first: 30) {
            nodes { author { login } createdAt isMinimized body url diffHunk }
          }
        }
      }
    }
  }
}'

# The jq program is assembled from single-quoted pieces so nothing here is
# shell-expanded; --all simply drops the unresolved-only filter.
JQ_HEAD='
(.[0].data.repository.pullRequest) as $pr
| {
    title: $pr.title,
    url: $pr.url,
    review_decision: ($pr.reviewDecision // "NONE"),
    threads_total: $pr.reviewThreads.totalCount,
    reviews: [ $pr.reviews.nodes[]?
      | select(.state != "PENDING")
      | {
          author: (.author.login // "ghost"),
          state,
          at: .submittedAt,
          body: ((.body // "") | if length > 600 then .[0:600] + " …[truncated]" else . end)
        }
    ],
    conversation: [ $pr.comments.nodes[]?
      | select(.isMinimized | not)
      | {
          author: (.author.login // "ghost"),
          at: .createdAt,
          body: ((.body // "") | if length > 1500 then .[0:1500] + " …[truncated]" else . end)
        }
    ],
    threads: [ .[].data.repository.pullRequest.reviewThreads.nodes[]'
JQ_FILTER='
      | select(.isResolved | not)'
JQ_TAIL='
      | {
          resolved: .isResolved,
          outdated: .isOutdated,
          path,
          line: (.line // .startLine),
          type: .subjectType,
          resolved_by: (.resolvedBy.login // null),
          url: (.comments.nodes[0].url // null),
          diff_hunk: ((.comments.nodes[0].diffHunk // "")
            | if length > 400 then .[0:400] + " …[truncated]" else . end),
          comments: [ .comments.nodes[]
            | select(.isMinimized | not)
            | {
                author: (.author.login // "ghost"),
                at: .createdAt,
                body: (.body | if length > 1500 then .[0:1500] + " …[truncated]" else . end)
              }
          ]
        }
    ]
  }'

if [ "$ALL" = true ]; then JQ_FILTER=''; fi

# --paginate follows pageInfo/$endCursor; --slurp wraps the pages in an array.
# ✻ piped into jq, not --jq: gh ≥2.95 rejects --slurp combined with --jq
gh api graphql --paginate --slurp \
  -f owner="$OWNER" -f name="$REPO" -F number="$NUMBER" \
  -f query="$QUERY" \
  | jq "${JQ_HEAD}${JQ_FILTER}${JQ_TAIL}"
