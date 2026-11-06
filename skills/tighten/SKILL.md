---
name: tighten
description: Single-pass token-level editorial treatment of LLM-read instruction prose — SKILL.md and its references, CLAUDE.md, rules/*.md, system prompts, agent briefs, tool descriptions — cutting dead weight and unburying live constraints, with every cut named by the desk test that killed it and adjudicated by a cold constraint-diff.
when_to_use: >
  Use when an instruction artifact that already shipped must get denser
  without changing what the executing model does: "tighten this skill",
  "/tighten", "every word pulls its weight", "make this denser", "prompt
  bloat", "cut the stale scaffolding". Distinct from /craft-prompt (writes,
  refines, and debugs prompts — correctness and house style; tighten is the
  subtractive economy pass over an artifact that already works), /gigarefine
  (multi-pass convergence loop over any artifact; tighten is single-pass and
  briefable as its prompts-density lens), /simplify (code diffs), and
  /gigaredesign (structure itself — section moves and duty changes are out of
  scope here, reported and routed).
argument-hint: '[file | dir | glob | skill name] [report-only]'
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash(head:*)
  - Bash(rg:*)
  - Bash(sort:*)
  - Bash(uniq:*)
  - Bash(wc:*)
  - Edit
  - Glob
  - Grep
  - Read
  - Workflow
  - Write
---

# Tighten — density pass over instruction prose

$ARGUMENTS

Cut every token whose absence leaves the executing model behaving identically; protect every token whose absence changes an action.

## Physics

1. **Weight is behavioral consequence.** A token is load-bearing iff deleting or changing it changes the executing model's behavior in some realizable scenario. "Reads better" is not a verdict; "behaves different" is.
2. **Two failure modes, both policed.** Dead weight — tokens with no behavioral consequence. Buried weight — consequential tokens that never land: the critical rule mid-file, the criterion-free adjective, the actor-less passive, the positional cross-reference.
3. **Constraint count beats token count.** Joint compliance collapses ≈ p^n as simultaneous rules accumulate, and models fail by silently DROPPING whole instructions rather than executing them sloppily (arXiv:2509.21051, arXiv:2507.11538). Cutting rules 15 through 20 moves more than shaving every adjective. Primary metric: constraints in the loaded surface; tokens secondary.
4. **Density is not minimum.** Correct edits sometimes LENGTHEN: a false doublet splits into two named criteria, an implicit scope quantifier gets restored, a missing actor gets named, a dying metaphor resolves into the literal operation it hid. Word count is an output of this pass, never its objective.
5. **Position is a free channel.** Edges land and middles do not (arXiv:2307.03172); filler degrades compliance with the rules that remain (arXiv:2302.00093); moderate compression can beat the original (arXiv:2310.06839).

Read `references/catalog.md` and `references/keep-list.md` before the first sweep: every desk test by id, with its pattern, its specimen pair, and its source.

## The oracle

Every desk test reduces to one probe. For an edit U → U′, a **cold** reader — a fresh Agent, never the context that made the edit — receives U and U′ separately and enumerates from each every action, condition, threshold, exception, ordering constraint, and prohibition. Diff the two enumerations. Empty diff → the cut was lard; commit it. Non-empty → the cut removed instruction; revert it, or escalate it as a deliberate behavior change.

Grade by constraint presence/absence per rule, never by "does it still say the same thing" — constraint compliance dies before semantic content under compression, so semantic preservation is the metric that fails last (arXiv:2512.17920). Keep the reader cold: the context that made the edit remembers the constraint it deleted and will vouch for its own work. Limit: on this skill's own files no reader is cold — every auditor is governed by the text under audit; the report states this instead of claiming the standard guarantee (since 2026-07-30 · finale).

## The verdict ladder

Desk tests NOMINATE. Ablation ADJUDICATES. Three rungs, ordered by cost; every committed cut names its rung in the report.

| Rung                    | What runs                                                                                                          | Fires on                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Desk test           | a named entry from `references/catalog.md`                                                                         | everything, cheaply; a cut with no nameable test does not happen                                                                                                                                         |
| 2 · Cold extraction     | the probe in § The oracle, no task execution                                                                       | every committed cut batch, by default                                                                                                                                                                    |
| 3 · Behavioral ablation | the artifact's regression cases or a constructed trigger probe, U vs U′, fresh Agent pinned to the executing model | keep-list-category cuts (§ Keep-list) · whole-rule deletions · desk-vs-probe disagreement · anything touching a frozen surface (§ Calibration: emphasis markers, sigils, Unicode conventions, tag names) |

Ablation rules, hardest first:

- Ablate at rule or sentence granularity. Tokens are too cheap to test; the rule is the unit of constraint.
- Never batch-delete a mixed group on one verification run: essential and redundant rule deletions have opposite effects when measured separately (arXiv:2512.06393), and an aggregate over a mixed batch cannot separate them.
- A whole-rule deletion greps the rule's LABEL — its bolded name, its diagnostic title — across the corpus before it commits, not just its phrases: other files cite rules by name (since 2026-07-30 · run 1 cut two labeled anti-patterns that evidence.md still cited; found thirteen runs later). Spent run ledgers under jobs/ are excluded from resolution sweeps — their citations are historical records, not live pointers (since 2026-07-30 · finale).
- Keep the cut only when absent ≥ present (arXiv:2302.00093). A tie means the tokens were dead, a win means they were harmful, a loss means one of them was a constraint.
- Revert rate above 1 in 10 edits aborts the pass: the ruleset is over-firing on this artifact — restore it and report the recalibration instead of continuing (editorial doctrine, first-principles threshold).
- No regression cases → the contract ledger written at step 0 — the numbered enumeration of every trigger, duty, threshold, output-shape promise, prohibition, and ordering constraint — is rung 2's baseline and rung 3's checklist.
- A regression set that all-passes trivial perturbations is saturated and uninformative. Evals "outlive the harness a little bit, but not by that much… one, two, three model generations" (Boris Cherny, "Building Claude Code", YC Startup School 2026 — transcript, verified 2026-07-29).
- Rung-3 instrumentation for a CLAUDE.md, rules file, or system-prompt target: `CLAUDE_CODE_SIMPLE=1` deletes all Claude Code system prompts including the tool prompts, and is the vendor's own ablation instrument (verified 2026-07-29 · CLI 2.1.220 binary probe; source: Cherny, YC Startup School 2026).
- Sibling-run precedent (the same cut shape, audited LOSSLESS elsewhere in a family) supports a desk verdict; it never substitutes for the target's own rung-2/3 evidence — every file gets its own audit (since 2026-07-30 · gigaredesign, fifth B4 Goal cut).
- The reader that ACTS on a span adjudicates it — prose the session model reads → the session class; strings shipped verbatim in a brief or schema → the class the skill pins for those spawns; a span a PROGRAM consumes (a jq filter, a shell parser, a glob) → run that program against U′, because extraction probes cannot vouch for a parser (since 2026-07-30 · gigaresearch, execute-plan, monitor-github runs).

Two regimes, chosen at step 0:

- **Maintenance** (leave-one-out) — the artifact mostly works. Remove one candidate, re-run, restore on a regression. Burden of proof sits on the CUT for every § Keep-list category.
- **Upgrade** (rebuild-from-zero, on a model-generation jump) — delete the instruction surface whole, then bring lines back one at a time to price each one. Burden of proof inverts onto the TEXT: a line stays out until it earns its way back. Re-addition is observation-gated, never predictive — a line returns after at least two observed stumbles on the same thing. "You don't wanna guess what's the instruction that the model needs… only when you see it repeatedly stumble on the same thing, that's when you add it back. But you don't wanna do it too early." (Cherny, YC Startup School 2026 — transcript.)

## The invariant

The executing model's BEHAVIOR on the contract — not the text's duty-list.

A scaffolding cut that rung 3 proves behavior-neutral on the current model is in scope: the constraint moved from prose into the model's prior, and the ledger records `carried by model default, ablated <ISO date> · <model id>`. An edit that would CHANGE behavior — dropping a live duty, narrowing a scope quantifier, deleting a threshold — is a proposal, not an edit: AskUserQuestion when a human is present, report-only when not. A span both protected and factually wrong takes the stricter route: propose with exact replacement text, never auto-apply — truth restoration does not override surface protection (since 2026-07-30 · gigadebug when_to_use reconciliation).

Bugs, rule conflicts, and under-specification found while cutting are FLAGged and routed, never repaired here. Two carve-outs, fixed in this same pass: a resolving reference broken by an in-scope cut (`rules/documentation.md` § Reference integrity), and a doc claim contradicted by its executable sibling — the artifact that runs is the oracle, and only the doc side is ever touched (reconciled 2026-07-30 · pr-review run surfaced the conflict between this sentence and the FLAG route).

## Keep-list

Over-cutting breaks a prompt SILENTLY: a lost constraint reads as clean prose. Each row keeps only against its discriminator; the load-bearing/counterfeit specimen pairs are `references/keep-list.md`.

| Category                                         | Load-bearing when                                                                 | Counterfeit signature                                                         | Protection                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Trigger vocabulary (`description`,`when_to_use`) | the phrase occupies a lexical field no sibling phrase covers                      | same-stem morphology                                                          | never auto-edit — AskUserQuestion, else FLAG      |
| Numbers and thresholds                           | the number is the enforceable part a third party could grade                      | a criterion-free adjective standing where the number belongs                  | rung 3                                            |
| Quoted literals                                  | one changed character could break a parser, grep, glob, shell, or matcher         | the prose gloss around the literal — cut the gloss                            | byte-identical; no re-casing, no smart quotes     |
| Provenance stamp · observed-surprise caveat      | an ISO-dated parenthetical, or a probe result no reader re-derives                | an undated "verified" claim, which is itself a finding; a hedge with no probe | never cut                                         |
| `Why:` line with incident content                | it carries a mechanism, measurement, or dated failure the rule lacks              | it re-asserts the rule in other words                                         | rung 3                                            |
| Rationale                                        | it decides an unenumerated case via a mechanism OUTSIDE the rule's vocabulary     | paraphrase-rationale; narration of how the mechanism works                    | rung 3                                            |
| Product-consistency instruction                  | it closes a human-preference gap: output shape, tone, a UX invariant              | a capability push in preference costume, which the null-prompt test does kill | exempt from the step-3 cut; judged on consistency |
| Named diagnostic                                 | it adds a way to NOTICE the failure the body never gives                          | the body rule restated in failure-mode costume                                | rung 3 · hardest call in this corpus              |
| Null branch · silence-on-success                 | it names the concrete action NOT to take                                          | a mood ("only report if useful")                                              | never cut toward silence                          |
| Escape hatch                                     | the authorizing subject is the user, and the hatch's bound is stated              | "unless necessary", "if appropriate" — these authorize the model              | rung 3                                            |
| Cross-framing repetition                         | each restatement closes a distinct failure route, writable in one sentence        | two restatements whose failure sentences match                                | rung 3                                            |
| Bracketing                                       | one unrecoverable constraint at entry AND exit of a >~40-line unit                | the third copy; any copy in a unit under ~40 lines                            | rung 3                                            |
| Exemplars                                        | it disambiguates a decision no rule states, across a boundary                     | two examples on the same side of a boundary — collapse to one                 | rung 3                                            |
| Negative boundary ("Distinct from /X")           | it names a real competitor AND the discriminating property                        | it fences a case no router would send here                                    | rung 3                                            |
| Priority markers                                 | violation is unrecoverable or silent AND a comparable neighbor is unmarked        | a stack of markers on routine dimensions                                      | rung 3                                            |
| Per-step `**Success criteria**`                  | it names an artifact or probe the step's prose does not                           | the step narrated back in the future tense                                    | rung 3                                            |
| Cross-context duplication                        | the second reader cannot see the first — fresh spawn, fork, post-compaction, hook | two copies one reader sees in one window, which drift into a contradiction    | rung 3                                            |

Product-consistency rows exist because an instruction can close a human's gap rather than the model's: "when you use Claude Code as a product, you do actually want some of these prompts because it helps you use the product and … helps the product behave and the model behave in the way that you would want when … you're using it as a person" (Cherny, YC Startup School 2026 — transcript).

A cut touching any § Keep-list row ships the rung-3 run that adjudicated it as its named regression input, or a KEEP verdict with its one-line reason. A desk verdict does not satisfy this — nothing in these categories drops on one.

## Calibration

| Warning                                                                                      | Consequence for this run                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The house corpus lacks the generic-slop profile — near-zero hedges, weasels, throat-clearing | Weight the run to § Keep-list and the B-series; expect ~80% survival, unevenly spread                      |
| Quoted spans, code fences, and `<example>` bodies are deliberate bad prose                   | Excluded at step 0; an edit inside a fixture breaks the thing the fixture demonstrates                     |
| Frozen surfaces — emphasis markers, sigils, Unicode conventions, tag names, delimiter style  | Rung 3 or FLAG, never a desk verdict; surface perturbations move accuracy unpredictably (arXiv:2310.11324) |

The observed profile is restatement across sections and files, terminal anti-pattern lists indexing body rules, reassurance closers, self-praising appositives, double-defined identifiers, and one mechanism narrated in `description` + `when_to_use` + the body opener (measured 2026-07-29 · `wc -w skills/*/SKILL.md rules/*.md CLAUDE.md` · 25 files, 35,241 words). A hedge-hunting sweep finds nothing here and then starts eating provenance stamps.

## Dispatch

Rows ordered most-specific first; first match wins.

Resolve `$ARGUMENTS` as a filesystem path first: a path to one file takes the file row; a path to a directory containing `SKILL.md` takes the skill-name row; any other directory or glob takes the corpus row. A bare token that is not a path and names a directory under `~/.claude/skills/` is a skill name.

| `$ARGUMENTS`                                          | Target                              | Mode                                          | Orchestration                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-only` present                                 | whatever another row matches        | report-only                                   | desk tests + rung 2; zero edits                                                                                                                                                                                                                                                                                                                                                                                                 |
| one file path                                         | that file                           | single artifact                               | inline; the session model judges every verdict                                                                                                                                                                                                                                                                                                                                                                                  |
| a skill name                                          | its `SKILL.md` + `references/`      | single artifact, multi-file                   | inline, one file at a time, disjoint files only — cluster mirrors reconcile file by file; a FILE-scoped run instead ships mirrors as DEFER with the mirror's location recorded. A shared CONVENTION across sibling files (a stamp shape, a section pattern) is not a content mirror — record it once as a family item, decide the normalization once, apply it per file (since 2026-07-30 · gigareview stamp-keyword precedent) |
| a directory, glob, or "all my skills"                 | every instruction artifact under it | corpus                                        | Workflow fan-out (this row is the Workflow opt-in), one proposer per artifact returning `{cuts:[{span,testId,verdict,rung,rationale}], ledger}`                                                                                                                                                                                                                                                                                 |
| empty, and this session created or modified artifacts | those artifacts                     | single artifact when one, corpus when several | inline for one; Workflow fan-out for several                                                                                                                                                                                                                                                                                                                                                                                    |
| empty, unattended (no human to answer)                | —                                   | stop                                          | report "no target named"; never pick one                                                                                                                                                                                                                                                                                                                                                                                        |

Every `agent()` call pins `model:` — each proposer pins `model: 'opus'`, inline delegation uses the Agent tool with the model pinned, and cold probes are always fresh agents. The session model judges every verdict and types nothing past a one-liner (CLAUDE.md model split).

Only the `report-only` row sets report-only mode. Protected surface is any span a § Keep-list row protects with `never auto-edit` or `never cut`; frozen surface is § Calibration's frozen-surfaces row. A protected or frozen surface _inside_ a target does not flip the mode: those spans take FLAG verdicts while the rest of the file edits normally, and `description`/`when_to_use` go to AskUserQuestion, or FLAG when no human is present.

Degraded path (no Agent, no Workflow): desk tests run as usual. Rung 2 is approximated by the step-0 contract ledger — written before any edit, re-extracted from the edited text afterward — and the report names that diff as non-cold. Rungs that never ran are listed in the report. Rung 3 cannot run at all in this mode: every candidate the ladder sends to rung 3 — all of step 3, every whole-rule deletion, every § Keep-list hit — ships DEFER with the probe it needs, or a KEEP verdict, never CUT.

## Steps

Coarse-to-fine, then back out (CLAUDE.md · Chiastic Structure): each step's unit is larger than the next's, so running fine before coarse polishes text step 2 deletes.

Steps 1–5 nominate; nothing on disk changes before step 7. Every candidate — cut, rewrite, split, or move — lands in the cut-set as a record, and the target file is edited only in step 7. Any success criterion in steps 1–5 that greps applied text runs in step 7 against the applied batch.

| Step | Unit                       | Catalog     | Default rung                          |
| ---- | -------------------------- | ----------- | ------------------------------------- |
| 1    | sentence                   | §R (R1–R7)  | 2                                     |
| 2    | section · paragraph · rule | §B (B1–B20) | 2; rung 3 for any whole-rule deletion |
| 3    | rule                       | §M (M1–M8)  | 3, mandatory                          |
| 4    | clause · token             | §S, §W      | 2, per edit                           |
| 5    | block · whole artifact     | §P, §U      | 3 where the target is frozen surface  |

If `references/catalog.md` or `references/keep-list.md` is not in context — a post-compaction continuation re-attaches only part of a skill — re-Read them, and this file when steps 6–8 are missing, before continuing. Every rewrite clears the §G gates first.

### 0. Resolve target, regime, and contract

- Match `$ARGUMENTS` against § Dispatch.
- Check provenance before sweeping: an upstream URL in the body, byte-parity with an external repo, or an import-only git history marks the span vendored — the third-party convention wins over house doctrine (CLAUDE.md § Rules). Vendored spans take FLAG verdicts only, recorded as upstream-PR candidates; a locally-authored suffix edits normally. A target tracked only on a non-default branch or inside another session's worktree is that session's surface — the whole run is report-only for it, findings handed off (since 2026-07-30 · home-inventory run). (since 2026-07-29 · agent-browser run: four correct verdicts an upstream sync would have silently reverted)
- Pick the ablation regime: a routine tighten runs maintenance; "a new model just landed", or a target whose stamps are dated to an older model generation, offers the upgrade regime — AskUserQuestion when a human is present, a recommendation in the report when not.
- Enumerate the behavioral contract before touching a token: every trigger, duty, threshold, output-shape promise, prohibition, and ordering constraint, each with the line it sits on. Name the target's existing regression cases; a target with none uses this ledger in their place.
- Record the excluded spans as line ranges: quoted blocks, `<example>` bodies, and fences that are output specimens or deliberate bad prose. A fence illustrating live configuration or layout is sweepable at rung 2 — its comments duplicate prose like any text (since 2026-07-30 · gigaresearch run: a directory-tree comment deadlocked B3 against a blanket fence exclusion); a blockquote carrying the file's OWN claims is likewise sweepable — the `> ` exclusion is for quoted foreign text (since 2026-07-30 · seq-thinking references run). Steps 4 and 5 gate this. Precedence when copies of this duty straddle the compaction line: P6's corollary governs (in-budget survivor); B3 otherwise; K22 protects only criteria naming artifacts (since 2026-07-30 · finale self-run, three-rule collision).
- Open the cut-set: one record per candidate, `{span, testId, verdict, rung, rationale}`.

**Success criteria**: `tighten-<target-basename>.md` in the session scratchpad — a corpus run writes one `tighten-<corpus-slug>.md` — holding N numbered contract lines each with its source line; excluded spans listed as line ranges; `wc -w`, constraint count, executing-model id, mode, and regime all written down before the first edit.

### 1. Reversal sweep

Negate each sentence. Would any competent author ship the negation as a real instruction? No → the sentence encodes no choice; CUT. Yes → KEEP, and its negation names the alternative the author rejected: state that alternative beside the rule where the artifact never names it. Platitudes die here because they survive every word-level test — every word in "write high-quality code" pulls its weight and the sentence still constrains nothing.

**Success criteria**: a negation ledger carrying the written negation of every deleted sentence, and the written negation of every sentence the sweep kept whose R1 pattern matched — a kept sentence with no negation on file is an unrun test.

### 2. Block ablation

Duplicate blocks dwarf adjectives, and this step holds most of the cuttable mass. Hunt § Calibration's observed profile at block scale, plus `## Goal` sections recombining the intro and the step success criteria, and one duty written once per parallel mode section.

- **Enforceability gate**: for each rule, write the one-line check that would detect its silent absence. A rule with no such check is unenforceable prose and a deletion candidate (arXiv:2507.11538).
- Collapse three or more sibling prohibitions sharing one principle into that principle plus the strongest example, then verify the collapsed version still suppresses each enumerated behavior — one behavior per rung-3 run.
- A block not needed on every invocation is a body-budget finding: FLAG it. This skill relocates nothing across files.

**Success criteria**: constraint count re-counted against step 0; one ablation run logged per whole-rule deletion, with its rung; every FLAGged block carrying its route.

### 3. Model-progression audit

An instruction exists to close a gap between what the model does unprompted and what you want. Models improve, gaps close, and the text becomes worse than tax: instructions calibrated for older models over-trigger and degrade current-model output, and the vendor's prescribed fix is removal rather than rewriting (verified 2026-07-29 · platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5 § Recommended scaffolding changes). Anthropic removed over 80% of Claude Code's system prompt for the Claude 5 generation (verified 2026-07-29 · Shihipar, "The new rules of context engineering for Claude 5 generation models", claude.com/blog) and reports "the model is actually a little bit more intelligent without these prompts" (verified 2026-07-29 · Cherny, "Building Claude Code", YC Startup School 2026 — transcript). Expect the largest cuttable mass here.

- **Null-prompt test**: would the current model already do this unprompted? Suspects by hit rate — anti-laziness pushes · verify-before-done and self-verification scaffolding · forced progress updates · reasoning-echo instructions · blanket tool defaults · enumerations of sibling behaviors one principle now covers. Adjudicate at rung 3: remove and re-run. The fix for stale scaffolding is deletion, not rewording. A § Keep-list product-consistency instruction survives a null-prompt pass by construction — its gap is the human's. Ablate against the weakest model that will read the file, never the strongest: an always-loaded file reaches pinned subagents running a tier below the session model, and a null-prompt pass there proves nothing about them (since 2026-08-03 · `CLAUDE.md` compression pass).
- **The other direction**: current models read literally and will not extend a rule past its written domain, so scope quantifiers ("every", "including X", "not just the first") are instruction. Probe a second instance the rule covers but never names; if the model applies the rule to instance 1 and not instance 2, write the domain down. This edit lengthens.
- **Emphasis**: a surviving IMPORTANT/MUST/CRITICAL needs an observed current-model failure behind it; absent that observation it is a rung-3 candidate. Dial back, never counter-rule.
- **Regime**: in maintenance, this step's worklist is the rule inventory from step 0, one candidate removed per run. In upgrade, the surface is already gone and the worklist is the re-addition queue — each line waits in it until its second observed stumble, logged with the run that produced it (→ M8).

**Success criteria**: every rule classified — carried-by-model-default with `ablated <ISO date> · <model id>` · still needed with its observed failure named · scope-restored · DEFERred; zero rules unclassified.

### 4. Structural rewrites and word sweeps

Actor-action, positive form, nominalization dissolution, expletive promotion, then the greppable word classes. These change information content, so each runs against the oracle on its own rather than in bulk.

- An un-rewritable passive, or a nominalization that will not dissolve, is a missing-actor bug report: log it as under-specification and FLAG it. Do not paper it over with a rewrite that invents an actor.
- Keep a negation when the prohibition is a hard boundary with no positive complement, or when it names the specific attractive wrong action the model would otherwise take. Then state both, with the ban beside its substitute on the same line, not in a footnote the model reads after choosing.
- Doublets, dying metaphors, and pretentious diction need judgment, not pattern-matching: delete half or SPLIT into two named criteria · state the literal operation or FLAG that the figure was the whole instruction · substitute only on denotational identity, since "idempotent" is not "safe".
- Expect low, uneven yield: over the always-loaded corpus §W1's hedge pattern returns 46 hits, its intensifier pattern 6, and §W2's, per its entry (measured 2026-07-29 · the W1 and W2 Pattern lines · `skills/*/SKILL.md`, 18 files, 32,214 words). A sweep that finds nothing reports nothing and stops — it does not go looking for provenance stamps to eat.

**Success criteria**: each rewrite carrying its own rung-2 constraint-diff; every un-rewritable passive and undissolved nominalization listed as a finding with its line; zero rewrites proposed inside the step-0 excluded spans.

### 5. Placement, unification, ascent

- Every rule whose violation is unacceptable sits in the first or last ~15% of its unit. A buried rule is worse than a deleted one: it costs tokens and still is not followed.
- The rule starts its line and takes the block's shortest sentence; its rationale takes the long one. Rule lists run hardest-first and cap near 10 items, with the alpha-sort exemption written into the artifact (→ P7) — unstated, a later pass sorts the list and forfeits the gain.
- One name per concept, repeated verbatim including capitalization: two surface forms read as two things. Positional cross-references ("above", "the second rule") become named anchors — a wrong pointer costs more than no pointer (arXiv:2406.17095).
- Then the ascent: word cuts have exposed duplicate sentences, those have exposed empty paragraphs, those have exposed mergeable blocks. Re-judge each outer layer against the now-visible core rather than tidying it in place, and retitle what shifted.

**Success criteria**: step 2's block ablation re-run on every block this step touches, with its constraint-diff attached; every retitle and MOVE recorded with its inbound-reference list; the dangling-pointer `rg` (inside the artifact and across the corpus) queued for step 7; zero rewrites proposed inside the excluded spans.

### 6. Adjudicate

Every candidate ends on exactly one verdict.

| Verdict | Means                                                                                       | Commit condition                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CUT     | delete the span                                                                             | killing test id named, rung-2 diff empty, rung 3 where the ladder demands                                                                                                                                                                                                                                                                                                                                                                                           |
| REWRITE | same span, new wording                                                                      | killing test id named, §G gates cleared, rung-2 diff empty at FILE level — stating at a decision site a constraint the file already carries elsewhere is diff-empty when the site is a distinct failure route within the bracket budget (since 2026-07-30 · gigarefine apply-pin) — or named as a deliberate scope restoration (restoring an implicit domain, never introducing a new threshold, which is a behavior change → FLAG); a rising word count is allowed |
| KEEP    | leave byte-identical                                                                        | one-line reason recorded; mandatory for every § Keep-list hit not cut                                                                                                                                                                                                                                                                                                                                                                                               |
| SPLIT   | one span becomes two named criteria                                                         | both criteria checkable separately; a rising word count is allowed                                                                                                                                                                                                                                                                                                                                                                                                  |
| MOVE    | same text, new position in the SAME file — block or rule granularity, never a whole section | destination named, source-block pointers re-checked, zero wording change in the same edit — a REWRITE inside a MOVEd span is its own record, applied after the MOVE                                                                                                                                                                                                                                                                                                 |
| FLAG    | reported, never applied                                                                     | a route named in FLAG routes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DEFER   | rung-3 candidate this run could not afford                                                  | named in the report with the probe it needs                                                                                                                                                                                                                                                                                                                                                                                                                         |

FLAG routes: a reproducible failure → /gigadebug · a prompt symptom → /craft-prompt Debug · a section move or duty change → /craft-prompt §Anatomy · an oversized always-loaded block → /craft-prompt §B body budget · the structure itself → /gigaredesign · vendored text → an upstream PR, or accept as vendored · an aging `(verified …)` stamp → re-verify per `rules/documentation.md` § Stale-claim custody · a doc contradicting its executable sibling → reconcile with the artifact that RUNS as the oracle (`rules/documentation.md` § Duplicated assertions) — a truth-restoring doc fix is in scope; changing the executable is never.

**Success criteria**: every cut-set record carrying one verdict, its rung, and a met commit condition; revert count recorded against edit count.

### 7. Apply and regress

Apply the committed cut-set. Run rung 2 over the batch. Run rung 3 wherever the ladder demanded it, one ablation per rule; what the run cannot afford ships DEFERred, never as a green. Every contract line resolves to surviving text, an approved deliberate cut, or a carried-by-model-default stamp.

- **Orphan sweep, batch-level.** Two halves of one explanation can be cut in the same pass — each reads as rationale alone and passes its own test, while together they were the only statement of why something exists. The constraint diff cannot see this, because no constraint was lost. Re-read every rule whose justification now survives only in a sibling that also lost its own, and every cross-reference whose target span is gone; restore one half. (since 2026-08-03 · `CLAUDE.md` compression pass — one batch removed both a rule's "hooks are disabled in some sessions" clause and the parenthetical on the fallback that clause justified, leaving a file where nothing explained that hooks are ever absent.)

**Success criteria**: rung-2 constraint-diff for the applied batch attached; every rung-3 run named with its outcome; revert rate computed, and under 1 in 10 or the pass reported as aborted.

### 8. Report

- **Contract ledger** — each constraint from step 0 → surviving location · deliberate-cut flag · `carried by model default, ablated <ISO date> · <model id>`.
- **Cuts and rewrites grouped by killing test id**, each with its rung. KEEP lines with their one-line reasons. DEFERred items with the probe each needs. FLAGged findings with their route.
- **Metrics** — words before/after, constraint count before/after, model id, regime, and lard factor (LF = cut ÷ original), reported and never chased (Richard A. Lanham, _Revising Prose_).
- **Rungs that did not run**, named as not-run. A regression set that all-passed trivial perturbations is named saturated rather than green.
- Zero findings: say so in one line. Never manufacture cuts to justify the run.

**Success criteria**: the report — appended to the same ledger file under `## Report` and summarized in-conversation — holds a ledger with zero unaccounted contract lines, the cut-set keyed by test id, the not-run rung list, and the model stamp the verdicts are dated to.

## Rules

Ordered by what breaks worst when violated — order encodes meaning here, exempt from house alpha-sort (CLAUDE.md § Rules).

- Reject any rewrite that introduces a sentence fragment, a new abbreviation, an arrow chain, or jargon absent from the target, and any rewrite that flattens a deliberate catalyst — a metaphor or a stated stance standing in for a procedure. Non-metaphorical vagueness ("be careful") still gets flattened (`references/catalog.md` §G).
- Resolve a conflict between two surviving rules in the text — when the conflict is inside a rewrite this run authors. A conflict found in the TARGET's pre-existing rules FLAGs per § The invariant; this bullet never licenses repairing one (reconciled 2026-07-30 · seq-thinking references run). A priority declaration ("this rule overrides all others") is not a mechanism: instruction hierarchy is a training-time property (arXiv:2404.13208).
- Do not restate what a sibling owns: why deletion is a performance change → `~/.claude/skills/craft-prompt/SKILL.md` principle 11 · the hedge ban list → `~/.claude/skills/craft-prompt/references/techniques.md` § Voice · the four compression artifacts to reject → that file's § Output formats, and no intensifier list exists there — `references/catalog.md` W1 carries it · regression-file shape, judge design, model-upgrade protocol → `~/.claude/skills/craft-prompt/references/evals.md` · multi-pass convergence, dry-pass/churn stop, across-pass ledger → `~/.claude/skills/gigarefine/SKILL.md`, which can brief this skill as one pass and one lens.
- A density move this skill teaches that `~/.claude/skills/craft-prompt/references/techniques.md` lacks belongs there, not duplicated here (Golden Rule, net-zero).
