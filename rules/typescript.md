---
paths:
  - '**/*.{cts,mts,ts,tsx}'
---

# TypeScript

Comment syntax: see `rules/comments.md`.

## Type aliases

- **Inline every single-use type alias.** Before reporting a code-writing turn complete, scan the diff for `type X = {…}` / `interface X {…}` referenced exactly once in the same file, and fold it into the signature.

  Exception: when the name carries meaning the expression doesn't — an inferred type pinned as `type Resolved = ReturnType<typeof f>` so it surfaces in errors, or a structural type whose name documents intent at each use site.

Why: a name used once is indirection with no payoff, and it hides the shape from the one signature that reads it.
