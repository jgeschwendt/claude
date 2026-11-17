---
paths:
  - '**/*.md'
---

# Documentation

Out of scope: pipeline-owned markdown (`~/.sandman/memories/` banks, their `MEMORY.md`) — dream/reflect-derived files are never hand-edited; route changes through the pipeline (CLAUDE.md § Memory). A memory this session itself wrote via `remember` may be updated in place (bump `updated:`) rather than duplicated.

## Present tense only

- **Living docs describe what exists today.** Migrations, predecessors, retired designs, and the decision process live in git history and plans — never in documentation. A "what X was, and where it went" section is a deletion, not a record. (since 2026-07-27 · orrery atlas recut — "Remove anything about the migration … that's git history.")
- **A feature is not done until its end-to-end flow is in the repo's living docs.** Trigger, components crossed, data path, configuration — into whatever the repo designates (stele AGENTS.md nodes and docs/ where adopted, the README elsewhere); a stub being wired up counts. (since 2026-07 · grove)

## Where things live

- **A contract is a page too — `docs/<name>.html` beside `docs/index.html`, linked from it, proxied at gigantic.dev/<project>/<name>.html.** No `docs/*.md`: the format specs, protocol contracts and guides that used to stay as markdown (BANK-FORMAT.md, MCP.md, SPEC.md, GUIDE.md) convert to pages with one `<section id>` per heading, and code, AGENTS and prompts cite them as `docs/<name>.html#<section>`. Routine definitions (`docs/routines/*.md`, a cloud routine's `README.md`) are runner input, not docs, and stay. (since 2026-10-19 · sandman: "lets make these files part of the gh pages site: docs/BANK-FORMAT.md and docs/MCP.md. no more md docs")
- **No markdown docs: a plan, report or research write-up is an HTML document served with hud.** `<name>/site/index.html` (more pages beside it) with its thread store at `<name>/threads.json`, under the harness's plans or reports directory, served through `@jlg/hud`'s review server and watched as under Pages, so the owner comments on it in place. Never a `.md` handed over with `code`. Files a tool reads as input (AGENTS.md, a README cover, SKILL.md, a rule, a routine doc) are runner input, not docs, and stay. (since 2026-11-17 · the floodgate plan handed over as markdown: "no markdown docs anymore, only html docs with hud, remember this"; reports the same day: "i want one large html report with hud")
- **A README is the name and one sentence, nothing else.** `# <name>` then one line of what the thing is — the sandman model: "Shifting sands for agentic sessions—`sandman` molds memory and runs the night shift." No docs link (gigantic.dev/<project>/ is the page, found from the landing), no license paragraph (`LICENSE.md` is the license), no "external contributions" line (never part of the license), no commands, no install. Everything operational — how it deploys, env vars, proxy rules, commands, how to add a project — lives in `AGENTS.md`, the contract agents read; the design and the plan live on the page; a section that would need updating when the code changes is moved, never kept. One exemption: a package whose README is its registry landing (HexDocs, npm) keeps the full document, because the registry renders it (since 2026-10-20 · pty: "skip pty that will be a hex doc at some point"). (since 2026-10-19 · gigantic.dev: "README.md should be as short as possible, its a cover, it shouldn't drift"; 2026-10-20 · sandman 299a3f3 cut the cover to one line and dropped the license paragraph; "can we drop External contributions are not accepted")

## Pages

- **World class: as tight as possible, minimal yet complete.** Every sentence earns its place, and the page covers the whole public surface once; the reference stays one link away instead of restated. (since 2026-10-26 · verax docs: "i want these to be world class, as tight as possible, minimal yet complete")
- **A docs pass tightens as it corrects.** Bringing a page current and making it denser are one job: every currency, migration or rename pass over a page also cuts slop (hedges, restated context, duplicated prose/tables, dead stamps) and reports lines before → after; a pass that only adds is a failed pass. (since 2026-11-01 · docs-currency pass: 'make sure they all tighten the docs too, no more slop')
- **Docs are a deliverable equal to code, from the first slice.** A new project, a rewrite or a feature ships its page with its d3 charts and in-page figures (the `figure` skill) in the same change as the code; a brief to an implementing agent names the page, its charts and its figures beside the code and tests, never "README and AGENTS only". (since 2026-11-10 · the sandman rewrite's first brief left the page out: "docs with d3 charts and figures are also equally important")
- **A docs page is reviewed live, with the hud on it.** Serve the page through `@jlg/hud`'s review server (jgeschwendt/typescript `packages/hud` README § Serve: `bun packages/hud/src/serve.ts <docs dir>`), which injects the comment layer without touching the source; watch `ws://127.0.0.1:<port>/__hud/watch` (one line per comment, the unanswered backlog replayed on every reconnect) with a background command that exits on the first `comment` or `reply` line and reconnects on close, started again after each one is answered — it has no expiry, where a Monitor lapses after 30 minutes and a lapsed watch misses comments ("your monitor has a bug", 2026-11-13); the watch stays up for as long as the server does, quiet hours included; answer each thread with `POST /__hud/reply` and leave resolving to the owner. Never poll the store or edit it by hand. (since 2026-11-11 · sandman rewrite docs: "let get my hud on the docs, i want to comment with feedback"; "monitor my threads too")
- **The page is where we design: a settled decision lands on it in the same turn.** A design choice agreed in conversation or in a comment thread is drawn and written on the page before the reply that reports it, with what is not built yet marked as such (a dashed "next" mark on a chart, a Next entry) and what runs today still stated; a decision that lives only in a thread is a stale page. (since 2026-11-13 · sandman rewrite: "lest keep the html updated, this is our spec / where we design")
- **Examples prove themselves.** A code example runs on the page, editable, and the output shown under it is the output of a real run, checked by the test suite — never a hand-written result comment. (since 2026-10-26 · verax docs: "can our example blocks be repls that run and prove the use cases?")

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
