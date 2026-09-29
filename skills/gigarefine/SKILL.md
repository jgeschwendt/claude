---
name: gigarefine
description: Iterative max-effort refinement of a named artifact — repeated hunt→judge→apply→regress passes until the evidence says stop; pinned opus agents type, the session model judges. Behavior-preserving by default.
when_to_use: >
  Use when the user wants an artifact driven to its best form — improved, not
  verified. Trigger phrases: "gigarefine", "/gigarefine", "gigarefactor",
  "refactor this properly", "make this the best version of itself", "polish
  until diminishing returns", "keep refining". Distinct from /gigareview
  (verifies session work, GO/NO-GO), /code-review (diff bug hunt), and
  /simplify (single-pass diff cleanups) — this is the giga tier: multi-pass,
  multi-agent, stops on evidence. Natural follow-on to /execute-plan or a
  gigareview GO when the work should now be made excellent, not just correct.
  When the structure ITSELF is the problem — components need adding,
  removing, rearranging — use /gigaredesign instead.
argument-hint: "[target + optional intent — e.g. 'src/parser/ readability', 'skills/foo/SKILL.md']"
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Workflow
  - Write
---

# Gigarefine

$ARGUMENTS

Improvement hunt, not bug hunt — bugs found en route get reported to the
user with their reproducing evidence and routed to /gigadebug (an observed
failure is its charter), never silently blended into refinement. Runs inline: the judge
needs session context.

## Steps

### 1. Resolve target, invariant, bar

- **Target**: `$ARGUMENTS` › artifacts this session created or modified › ask.
  Resolve to a concrete file list. An intent word in `$ARGUMENTS`
  ("readability", "efficiency") narrows the step-3 lens set; absent, run all.
  Intent gate first: an ask naming structural outcomes — components split,
  moved, merged, removed — routes to /gigaredesign NOW; "refactor" in the
  wild usually means restructure, and a polish pass is the wrong deliverable
  for it. Unattended (headless/scheduled, no human to answer), an explicit
  target is required — the "ask" rung can't fire, and autonomously picking a
  target is how an acceptEdits session refines the wrong thing: stop and
  report instead.
- **Invariant by artifact class** — the thing no pass may change. A mixed
  target partitions by class: each class carries its own invariant and the
  pass-level regress runs every applicable check — one class's green never
  vouches for another.
  - _code_ → observable behavior: the full test suite. No suite → write
    characterization tests FIRST at the target's public boundary (what
    callers observe), then per pass add coverage for any accepted proposal
    reaching behavior the boundary tests don't; refining unobserved
    behavior is redesign wearing refinement's clothes.
  - _docs_ → truth: whole-file claim custody per `rules/documentation.md` —
    every pass re-owns the file's external claims, not just its diff.
  - _prompts/skills_ → the behavioral contract: triggers, output shape,
    regression cases (craft-prompt evals doctrine). Refinement may sharpen
    how the contract is stated, never what it promises.
- **Baseline**: run the invariant check now. Red baseline → stop and report;
  refining on red blends repair into refinement and neither can be judged.
  Green → record a checkpoint (a commit — invoking this skill authorizes
  checkpoint commits, repo conventions govern form; or a stash-ref noted in
  the ledger when the tree holds unrelated work). Every later "revert" means
  "restore to the last green checkpoint" — without one, revert is undefined
  and destroys whatever uncommitted work preceded this run.
- **Axes** (per artifact class + repo conventions): code — coherent ·
  efficient · maintainable · readable · tested; docs/prompts — actionable ·
  coherent · focused · succinct · unambiguous.

**Success criteria**: file list, invariant named and green, axes stated in
one line. Open a ledger (scratchpad `gigarefine-<slug>.md`) — passes, proposals,
dispositions, reversals live there, not in conversation memory.

### 2. Chiastic map

Read the whole target and identify its core — the load-bearing center — and
the layers around it (CLAUDE.md · Chiastic Structure). Passes work
center-out: the core refines first; outer layers are then rebuilt against
what the refined center required, not merely polished in place. Record the
map in the ledger; hunt briefs cite it so agents know which layer they own.

**Success criteria**: a one-screen map — core, layers, dependency direction.

### 3. Pass loop — hunt → judge → apply → regress

Each pass, until step 4 says stop:

- **Hunt**: fan out one agent per lens through the Workflow tool (this
  instruction is the Workflow opt-in), every call pinned `model: 'opus'`
  (CLAUDE.md model split — the hunt is legwork). Schema-force returns:
  `{proposals: [{location, current, proposed, lens, rationale, invariantRisk}]}`.
  Each brief carries the scope triad (layer it owns · layers sibling lenses
  own · the map + axes as shared context) and the pass number with the
  ledger's rejected-list — so lenses don't re-propose the dead.
  Taste-bearing prose (resume, marketing copy, public writing): run a
  second panel of the same lenses pinned `model: 'fable'` beside the opus
  one — hunting there is critique, and model diversity surfaces phrasings
  one model never reaches. (since 2026-09-24 · jlg.io resume: "use some
  fabel agents too")
  Code lenses: **deletion/redundancy** · **structure/altitude** ·
  **naming/clarity** · **efficiency** · **idiom/consistency** ·
  **coverage** (tests the refactor makes cheap). Docs/prompts: the step-1
  axes as lenses; prompts additionally get craft-prompt's refinement
  checklist as the brief's checklist, and the succinct axis briefs
  /tighten's desk tests (copy from
  `~/.claude/skills/craft-prompt/SKILL.md` §Refinement checklist and
  `~/.claude/skills/tighten/references/catalog.md` — a cold brief can't
  cite what it never loaded).
- **Judge** (session model, inline — judging needs whole-run context and
  is never delegated): accept or reject each proposal against the invariant and
  the axes. Proposals arrive as claims, not evidence (premise inheritance).
  Reject blends — a proposal serving two axes poorly loses to one serving
  either well (CLAUDE.md · Compromise). Two proposals for the same location:
  swap presentation order and re-judge before picking (order bias is real
  and validated; verified 2026-07-14 · arXiv 2604.16790). Every rejection gets a
  recorded reason in the ledger — rejected-with-reason is never re-litigated
  in a later pass.
- **Apply**: group accepted proposals by file — one agent owns ALL of a
  file's proposals, agents on disjoint files may run in parallel, same-file
  work never splits (two agents read-modify-writing one file lose the
  earlier write, and the ledger still records both as applied). Each agent,
  pinned `model: 'opus'` (CLAUDE.md model split), carries the execute-plan
  executor contract (DONE requires executed
  verification with output in the return — read
  `~/.claude/skills/execute-plan/SKILL.md` step 2 when briefing) with
  verification scoped to its OWN edit (compile / targeted probe); the FULL suite belongs to the
  pass, not the agent — run against a half-applied tree it fails on a
  sibling's in-flight edit and indicts the wrong change. The session model
  may type only trivial one-liners where agent overhead exceeds the edit.
- **Regress**: after every apply agent has returned, run the full invariant
  check — not just probes near the edits; hardening one path often breaks
  another. Docs/prompts regress executably too: re-verify each external
  claim the pass touched against the live system, and re-run the prompt's
  regression cases where they exist — a class whose check cannot fire ends
  the run NO-VERDICT, never green-by-vacuity. Red → restore to the last
  green checkpoint or fix within this pass; a pass NEVER ends red. Each
  green pass ends by advancing the checkpoint.
- **Ledger**: append pass number, proposals seen/accepted/rejected, reversals.

**Success criteria**: pass ends green with every proposal dispositioned in
the ledger.

### 4. Converge on evidence

Stop when any fires:

- **Dry pass** — zero accepted proposals, counted ONLY when every lens
  returned a schema-valid result: an errored, dead, or empty-by-failure
  hunt agent is a re-run (once — a lens failing twice is dropped from the
  pass and its absence named in the report, never silently), otherwise a
  degraded fleet reports "already converged" on a no-op run. A genuine dry
  pass 1 is a valid outcome: report "already converged", never manufacture
  proposals to justify the run.
- **Churn** — a pass proposes reverting an earlier accepted change: the axes
  are now trading against each other; this is the definition of diminishing
  returns, stop and report the tension.
- **Cap** — 5 passes (safety valve). Hitting it means unconverged: say so.

Acceptance counts should shrink pass over pass; a pass accepting MORE than
its predecessor signals scope creep — re-check the briefs against the map
before continuing.

**Success criteria**: stop reason named and evidenced from the ledger.

### 5. Report

The curve (accepted per pass), what changed by lens, what was deliberately
NOT done (rejected proposals worth naming, semantic changes proposed but out
of scope), final invariant run, stop reason.

**Success criteria**: the user can see what improved, what was spared, and
why it stopped, from this report alone.

## Rules

- The invariant outranks every axis. An improvement requiring a behavior,
  truth, or contract change is out of scope — report it, don't apply it,
  unless the user's stated intent explicitly asked for redesign. Structural
  wants that keep surfacing escalate to /gigaredesign, not into scope.
- Every `agent()` call pins `model:` — an unpinned call is a bug, not a
  default. The session model judges, maps, and reports; it never types
  implementation (trivial one-liners excepted).
- Removals of public surface — exported API, published doc sections, skill
  trigger phrases — are proposed to the user via AskUserQuestion when
  present, listed in the report when not; never auto-applied. Others depend
  on that surface; the invariant check can't see them.
- Bugs discovered mid-pass: CONFIRMED-reproducible ones may be fixed as their
  own dispositioned proposals; anything needing investigation is reported and
  routed to /gigadebug.
