---
paths:
  - "**/*.{bash,sh}"
  - "**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "**/*.{ex,exs}"
  - "**/*.rs"
---

# Comments

## Headers

- **Cap a section divider at 80 columns total; use dividers sparingly.**

```bash
# ─── section title ────────────────────────────────────────────────────────────
```

```rust
/// ─── section title ──────────────────────────────────────────────────────────
```

```typescript
// ─── section title ───────────────────────────────────────────────────────────
```

## Style

- **A comment on a declaration is a docblock** — `/** … */` (`///` in Rust) above it, not a `//` line.
- **Inline comments are lowercase fragments, no trailing period** — `// per request, never prerendered at build time`.
- **One line when it fits the formatter's width; keep only the why the code can't show** — cut restatements of the code, keep a non-obvious constraint (`// COVERAGE, not NODE_ENV: the coverage run is a production build`).

(since 2026-10-08 · jlg.io `src/app/api/coverage/route.ts` comment pass)
