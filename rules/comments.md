---
paths:
  - '**/*.{bash,sh}'
  - '**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}'
  - '**/*.{ex,exs}'
  - '**/*.rs'
---

# Comments

## Headers

- **A section divider ends exactly at the formatter's width (oxfmt's `printWidth`, 100 in house repos); use dividers sparingly.** `@jlg/oxlint`'s `comments/divider` reads the width from the nearest oxfmt config, enforces it on JS/TS and autofixes the `─` run; a title too long to fit is a sign to shorten it, not to wrap. (since 2026-10-23 · "should be 100ch width"; width follows oxfmt 2026-10-27 · rocket-com formats at 80)

```bash
# ─── section title ────────────────────────────────────────────────────────────────────────────────
```

```rust
/// ─── section title ──────────────────────────────────────────────────────────────────────────────
```

```typescript
// ─── section title ───────────────────────────────────────────────────────────────────────────────
```

## Style

- **A comment on a declaration is a docblock** — `/** … */` (`///` in Rust) above it, not a `//` line.
- **Inline comments are lowercase fragments, no trailing period** — `// per request, never prerendered at build time`.
- **One line when it fits the formatter's width; keep only the why the code can't show** — cut restatements of the code, keep a non-obvious constraint (`// COVERAGE, not NODE_ENV: the coverage run is a production build`).

(since 2026-10-08 · jlg.io `src/app/api/coverage/route.ts` comment pass)
