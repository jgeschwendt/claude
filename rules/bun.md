---
paths:
  - '**/*.{cjs,cts,js,mjs,mts,ts}'
---

# Bun scripts

Applies to any script run by Bun (`#!/usr/bin/env bun`, skill scripts).

- **Never import `node:*`.** Reach for the `Bun` global first — `Bun.file`/`Bun.write` for fs, `Bun.spawn`/`Bun.spawnSync` for child processes, `Bun.stdin.json()`/`.text()` for hook input, `Bun.env`. A builtin with no `Bun` equivalent comes through `process.getBuiltinModule("<name>")` at the call site, never an `import`. (since 2026-09-03 · hooks/format.js rewrite)
- **The subcommand comes first: `bun test --cwd <dir>`, never `bun --cwd <dir> test`.** A flag ahead of `test` makes it `bun run test`, the package.json `test` script (bun 1.4.4, probed), and where that script is the gate and a gate step holds the command, the gate forks itself until the machine is out of memory. A gate also refuses to nest: it marks its children's environment and exits 1 when it sees its own mark. (since 2026-11-23 · claude `scripts/test.ts`: two freezes ended by the power button, 17:19 and 20:25)
