---
paths:
  - '**/*.{jsx,tsx}'
---

# React

## Conditional rendering

- **Short-circuit with `cond && <X />` instead of `cond ? <X /> : undefined/null`, boolean-izing any numeric condition first (`items.length > 0 && …`).** Reserve the ternary for two real elements (`cond ? <A /> : <B />`); `!cond && <X />` inverts. A bare falsy number doesn't skip the render — it renders a literal `0`. (since 2026-07-19 · the retired @jlg/eslint's react/jsx-no-leaked-render: error; oxlint has no port of that rule (verified 2026-09-08 · oxlint 1.82 `--rules` catalog), so this prose is now the only enforcement)

Why: a ternary whose else-branch renders nothing is indirection for a guard `&&` states directly — and the guard must be boolean, or `&&` leaks falsy numbers into the DOM.
