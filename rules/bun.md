---
paths:
  - "**/*.{cjs,cts,js,mjs,mts,ts}"
---

# Bun scripts

Applies to any script run by Bun (`#!/usr/bin/env bun`, skill scripts). The statusline and the format hook are Rust binaries built from this repo's crate, not Bun scripts.

- **Never import `node:*`.** Reach for the `Bun` global first — `Bun.file`/`Bun.write` for fs, `Bun.spawn`/`Bun.spawnSync` for child processes, `Bun.stdin.json()`/`.text()` for hook input, `Bun.env`. A builtin with no `Bun` equivalent comes through `process.getBuiltinModule("<name>")` at the call site, never an `import`. (since 2026-09-03 · hooks/format.js rewrite)
