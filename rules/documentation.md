---
paths:
  - "**/*.md"
---

# Documentation

Out of scope: pipeline-owned markdown (`~/.sandman/memories/` banks, their `MEMORY.md`) — dream/reflect-derived files are never hand-edited; route changes through the pipeline (CLAUDE.md § Memory). A memory this session itself wrote via `remember` may be updated in place (bump `updated:`) rather than duplicated. (reconciled 2026-08-27 · `~/.orrery/memory/` no longer exists; sandman owns session memory)

## Present tense only

- **Living docs describe what exists today.** Migrations, predecessors, retired designs, and the decision process live in git history and plans — never in documentation. A "what X was, and where it went" section is a deletion, not a record. (since 2026-07-27 · orrery atlas recut — "Remove anything about the migration … that's git history.")
- **A feature is not done until its end-to-end flow is in the repo's living docs.** Trigger, components crossed, data path, configuration — into whatever the repo designates (stele AGENTS.md nodes and docs/ where adopted, the README elsewhere); a stub being wired up counts. (since 2026-07 · grove)

## Machine portability

- **Tracked `~/.claude` files sync to every machine — write them machine-neutral.** No host-local facts: bound addresses/ports, cron/launchd wiring, clone paths, absolute paths outside `~/.claude`. Point at the owning repo (portable name or URL) and let its docs carry the machine wiring. (since 2026-07-20 · README.md hardcoded the orrery dashboard address + hourly sweep coupling)

## Stale-claim custody

- **Creating or editing a doc means owning the whole file, not the diff.** Before finishing, re-read the file for claims about external systems (harness features, tool capabilities, CLI flags, API surfaces) — the repo cannot vouch for these. Verify each against the live system or current vendor docs; mark what you couldn't check `(unverified <date> · <reason>)`. A claim already carrying a dated `(verified …)` marker is banked work — re-verify only when the date is old enough that the platform has plausibly moved.
- **Re-verify every negative capability claim before letting it stand; never write a new one without a live probe.** "X has no Y", "X can't", "the only way is" — platforms grow, so these rot by default. One you can't probe stands only with an `(unverified …)` marker.
- **A recap is a lead, never a verifier — `(verified …)` requires the primary source.** Press coverage, aggregator summaries, and secondhand writeups locate the source; only the artifact itself (transcript, thread, repo, paper, live probe) verifies the claim, and the stamp cites the primary. (since 2026-07-29 · Cherny YC-talk "80% deleted" datum stamped verified from press recaps; the primaries later split the claim across two artifacts — the YC transcript says "a little bit more intelligent without these prompts", the "no measurable loss on our coding evaluations" line is Shihipar's claude.com/blog article — a recap blend verifies neither)
- **An undated verification marker is itself a finding.** "verified against current docs" inflates trust while rotting invisibly — date it or treat the claim as unverified.
- **Delegated doc edits carry whole-file custody in the brief.** "Surgical edits only" exempts untouched claims by construction; never scope a subagent's consistency check to repo-internal sources alone.

Why: every review is diff-scoped and every consistency check uses the repo as its oracle — a false claim about the outside world that predates the diff has neither reviewer nor oracle. (since 2026-07-15 · monitor-github/references/monitoring-guide.md claimed "Claude Code has no dedicated monitor tool" for months while SKILL.md recommended that very tool.)

## Reference integrity

- **A rename, move, or delete is not done while a resolving reference remains.** `rg` the old name (word-bounded / path-scoped for common words) and fix every hit that _resolves_ — links, `paths:` frontmatter globs, procedure steps, mermaid node labels, code fences that instruct. Historical prose describing the old name (changelogs, incident stamps, memories) stays. Parallel agents with disjoint file ownership never satisfy this — each greps only its own files, so retired terms survive in the seams while every agent reports green; the orchestrator runs the one repo-wide case-insensitive sweep after merge. (since 2026-08-26)
- **Relative links resolve from the linking file's directory.** Moving a doc shifts every `](./x)` both inside it and pointing at it — recompute, don't just move.

Why: nothing validates markdown pointers. (since 2026-07-19 · deleting rules/learn-code.md left dangling references in skills/dissolve/SKILL.md, a mermaid diagram in @apps/web/lib/core/memory.md (since extracted to orrery lib/orrery/memory.md), and a CLAUDE.md pointer — found only by `rg`, flagged by nothing.)

## Duplicated assertions

- **Changing a fact means reconciling every doc in its cluster that asserts it.** `rg` the claim's key noun across the doc's own cluster — SKILL.md ↔ its references/, prose ↔ its diagrams, the files it links — and fix each assertion in the same turn; two files can contradict without either linking the other.
- **A diagram or table mirroring prose is a second copy.** Edit both in the same turn, or delete the redundant one.
- **A cardinal count introducing a list is a claim the list will outgrow.** On any add/remove, fix the "three behaviors"-style intro count — or drop the number, the more durable fix.

Why: the monitoring-guide incident above was also a sibling contradiction — the two files never linked each other, they just disagreed; readers trusted whichever loaded first.

## Stamps

- **`(since <date> · <source>)`** — origin: when a rule or standing claim was introduced or its meaning last changed, plus the artifact that grounds it (source portability: CLAUDE.md).
- **`(verified <date>)`** — the last live check of a claim. Verifying an `(unverified …)` claim replaces its marker with this.
- **`(unverified <date> · <reason>)`** — custody was owed and the claim couldn't be checked; a dated, greppable debt instead of silent trust.
- **`(measured <date> · <source>)`** — a number this run derived rather than read: a count, a ratio, a benchmark. The source names what was counted, so a later editor can re-derive it. (since 2026-07-30 · /tighten corpus sweep, keyword precedent set across the giga family)
- **`(fetched <date>)`** — a primary doc retrieved and quoted that day; verifies the quotation, not the behavior it describes. (since 2026-07-30 · /tighten corpus sweep D-7)
- **`(observed <date>)`** — an incident seen live, once; the observation is its own source — weaker than a re-runnable `verified` probe. (since 2026-07-30 · /tighten corpus sweep D-7)
- **`(reconciled <date> · <source>)`** — two artifacts conflicted; records the settlement and the side that won. (since 2026-07-30 · /tighten corpus sweep D-7)
- **Stamp dates are ISO (`2026-07-19`)** — never the `MM/DD/YY` commit-subject format; the two are deliberately distinct.
- **Stamp what a future editor must re-ground** — rules, standing claims, incident-derived exceptions; skip prose whose truth doesn't age. (since 2026-07-19 · the `(since …)` shape recurred across rules/ and skills/ with no defining doc)
