---
name: gigaredesign
description: Full-comprehension re-architecture of a codebase — map every component, reimagine the structure it should have, commit to one whole design, and rebuild through an always-green staged migration. External behavior preserved; internal structure is the work-product.
when_to_use: >
  Use when the structure itself is the problem — the user wants a codebase
  understood whole and rebuilt better: components added, removed, merged,
  rearranged. Trigger phrases: "gigaredesign", "/gigaredesign",
  "rearchitect this", "redesign this codebase", "this grew wrong — rebuild
  it", "reimagine how this should be structured". Distinct from /gigarefine,
  which polishes within the existing structure and treats structural change
  as out of scope — this skill is where gigarefine's rejected
  requires-redesign proposals escalate. Understanding and design happen here;
  the rebuild hands to /execute-plan, verification to /gigareview.
argument-hint: "[scope + optional forcing concern — e.g. 'apps/web', 'src/ — the plugin system fights every feature']"
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Skill
  - Workflow
  - Write
---

# Gigaredesign

$ARGUMENTS

The journey inward is discovery, the journey outward is redesign (CLAUDE.md ·
Chiastic Structure) — this skill is that philosophy at codebase scale.
Nothing is reimagined until every component's responsibility, dependencies,
and reason-for-being are mapped. The session model synthesizes, designs, and
judges; pinned opus agents do all sweeping and rebuilding.

## Reference library

Domain knowledge lives in `${CLAUDE_SKILL_DIR}/references/` — the steps below
cite it, and every hunt or plan brief names the catalog entries it works from
(a lens or stage that can't name its entry is improvising). Load with Read at
the step that needs it, not up front; a brief handed to a fan-out agent
carries the `${CLAUDE_SKILL_DIR}`-resolved absolute path — agents run from the
project cwd, where a bare `references/…` does not resolve.

| File                    | Load when                                           | Holds                                                                            |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `references/smells.md`  | briefing the map sweep (step 2)                     | architecture-smell lens catalog — detection signals, thresholds, move cross-refs |
| `references/styles.md`  | generating and judging candidates (step 3)          | organizing-principle palette — fits/fights map signals, canonical seams, cost    |
| `references/metrics.md` | scoring candidates (step 3), wiring guards (step 5) | computable coupling/cohesion/churn metrics + fitness functions                   |
| `references/moves.md`   | composing the migration plan (step 4)               | named migration moves — mechanics, the stays-green trick, classic failure modes  |

The catalog grows by the Golden Rule: a smell, style, move, or metric
observed in the field that the files don't teach gets encoded into its file
in the turn it's noticed, stamped with portable provenance.

## Steps

### 1. Fence and invariant

- Scope: `$ARGUMENTS` › the cwd repo › ask. A forcing concern in `$ARGUMENTS`
  ("the plugin system fights every feature") is a design input, not a scope
  limit — record it. But a concern with NO path at a multi-app root does not
  scope to the whole repo: confirm the intended app/dir first (unattended →
  stop and report) — a whole-monorepo sweep for a one-app concern is the
  expensive wrong fence.
- The invariant is the EXTERNAL contract: public API, CLI surface, wire and
  file formats, persisted schemas, observable behavior. Baseline the full
  suite now; where the boundary is untested, write characterization tests AT
  THE BOUNDARY only — internal tests pin the old structure, and pinning what
  you're about to demolish rebuilds the old design inside the new one.
- Red baseline → stop and report; repair and redesign don't blend (same rule
  as gigarefine).

**Success criteria**: scope resolved to concrete dirs; contract enumerated
WITH per-item coverage — every enumerated behavior maps to ≥1 test/probe in
the boundary suite (coverage table in the ledger; enumerated-but-untested is
exactly where a fully-green migration breaks the contract); boundary suite
green. Open a durable workspace at `~/.claude/plans/gigaredesign-<slug>/`
(`map.md`, `design.md`, `ledger.md`) — NOT the session scratchpad: on the
unattended path map + design are the sole deliverable and scratchpad dies
with the session.

### 2. Map — the journey inward

Fan out the comprehension sweep through the Workflow tool (this instruction
is the Workflow opt-in), every call pinned `model: 'opus'`:

- One agent per subsystem (split by top-level dirs or build units),
  schema-forced: `{components: [{name, files, responsibility, dependsOn,
dependedOnBy, publicSurface, stateOwned, smells}]}` — the `smells` field
  cites `references/smells.md` entries by name, so briefs include that file.
- Cross-cutting agents alongside: **dependency-graph** (cycles, layering
  violations) · **duplication** · **data-flow** (who owns which state) ·
  **git-churn** (change frequency; churn × coupling locates the pain).
- **Deterministic tools first**: the map is built from exact instruments —
  LSP where a server is installed, `mix xref graph` / `madge` /
  `cargo-modules` for dependency graphs, `jscpd` for clones, `git log
--name-only` for churn and co-change — with agent reading layered on top.
  Embedding/RAG retrieval is deliberately omitted: the totality gate reads
  everything anyway, and retrieval solves "what to read when you can't read
  it all", a regime this skill refuses to map in. Revisit only when the
  target exceeds read-whole scale, and then as a duplication/concept-location
  lens, never the map's backbone. (since 2026-07-15 · design decision)
- A target small enough to read whole skips the fan-out and maps directly —
  the artifact, not the fleet, is the requirement.

Synthesize `map.md` in-session: component inventory, dependency graph, and
one paragraph naming the design the code IMPLIES versus the design it HAS —
that gap is step 3's raw material. Every file lands in exactly one
component; an unmappable file is a finding, not a leftover.

**Success criteria**: total file coverage proven by reconciliation — diff
`git ls-files <scope>` against the union of every component's `files`; the
diff is empty or every remainder explicitly dispositioned. A file no agent
saw never reports itself as unmappable — only the ground-truth diff catches
it. `map.md` holds inventory, graph, gap statement.

### 3. Reimagine — the center

Session-model work, never delegated — this is the whole-system synthesis the
skill exists for.

- Generate 3 candidate architectures from genuinely different organizing
  principles drawn from `references/styles.md` — pick styles whose
  fits-when signals the map actually shows. Each candidate must be WHOLE: components,
  boundaries, and an old→new disposition for every mapped component
  (moved · merged · split · absorbed · deleted-with-reason). No blends — a
  hybrid inherits the costs of both parents and the coherence of neither
  (CLAUDE.md · Compromise).
- Always include the **null design**: the strongest honest case that the
  current structure is right and the pain is polish-level. If it wins, stop —
  deliver the map plus a /gigarefine recommendation; a rebuild is never
  justified by the effort already spent mapping.
- Judge on fit to actual responsibilities (from the map, not aspiration),
  migration cost, seam quality for staged rebuilding, and the forcing
  concern — scored with `references/metrics.md` computed from the SAME map
  data for every candidate. The map's above-threshold smells are gating
  inputs, not color: the chosen design names, per smell, the disposition
  that resolves it or an explicit acceptance — a design that leaves the
  map's worst finding intact was chosen by aspiration, not evidence. Swap presentation order and re-judge before
  committing (verified 2026-07-14 · arXiv 2604.16790).
- **Human checkpoint — the one-way door**: present winner, runner-up, and the
  null case via AskUserQuestion. Unattended → stop here: map + design ARE the
  deliverable; a rebuild never launches without approval.
  Unattended, open the door instead of only waiting at it:
  `id=$(docket open "<design to commit to>" --kind decision --option "<winner>" --option "<runner-up>" --option "null design" --to "job:$(basename "$CLAUDE_JOB_DIR")" --body -)`
  with `design.md`'s comparison on stdin (`--to any` when not a job), then
  `docket wait "$id" --timeout 540` in a loop, re-waiting on 124. An `answer:`
  IS the approval — record it in `design.md` and continue to step 4, resolving
  the thread when the rebuild lands; anything else → `docket reply` (a table
  for a comparison) and wait again. No answer, no rebuild.

**Success criteria**: `design.md` holds the chosen design with a total
old→new disposition, the runner-up, the null verdict, and the user's
approval.

### 4. Plan the migration — the journey outward

Strangler-fig, never big-bang: stages where every stage ends with the
boundary suite green and the system shippable. Order by the dependency graph
(dependencies before dependents, unless a seam decouples the cut). Unordered
sibling stages must own DISJOINT file sets — dependency edges are not the
only coupling: two extractions from one host component both rewrite the
host; overlapping ownership gets an explicit ordering edge, with the later
stage's brief authored against the earlier stage's output, never the
original tree. Every stage names the `references/moves.md` moves it
composes — a stage that can't name its move is improvising. Each stage in
execute-plan's brief shape — files owned, machine-checkable success
criteria, scope triad (files owned · files owned by sibling stages ·
shared read-only context) — and each stage's brief ends with its checkpoint
commit: invoking this skill authorizes per-stage commits, and a rollback
floor promised only in a reference file the executor never reads does not
exist. Write to `~/.claude/plans/gigaredesign-<slug>.md`. Include a
final stage wiring the chosen design's rules as fitness functions
(`references/metrics.md` §2), then negative-probing each guard — introduce
a known violation, confirm the guard fails, revert; a guard that exits 0 on
the current tree has proven nothing until it has been seen to fail.

**Success criteria**: no stage depends on a later one; unordered siblings
own disjoint files; each ends green at a commit; the last stage leaves the
design enforced by tests that have each failed once on purpose.

### 5. Rebuild and close

- Invoke /execute-plan on the plan — it owns the model split, executor
  contract, and per-step verification; don't restate its machinery here.
- Then /gigareview at the user's stakes for the GO/NO-GO, and offer
  /gigarefine on the new structure — refinement after re-architecture, not
  instead of it.
- Report: old design and new design in one paragraph each, the disposition
  table (added/removed/merged/moved/deleted), stages shipped, contract
  verification, and what the null case conceded.

**Success criteria**: the user can see what the codebase became and why from
the report alone.

## Rules

Ordered by what breaks worst when violated — order encodes meaning here,
exempt from house alpha-sort (CLAUDE.md § Rules).

- The external contract is the invariant. Internal tests pinning demolished
  structure are deleted WITH that structure and logged in the ledger.
- The old→new disposition is total: every mapped component lands somewhere
  or carries a deletion reason — silent drops are how rewrites lose features.
- No rebuild without an approved design. Map + design alone are a valid,
  complete outcome (and the only outcome when the null design wins or no
  human is present).
- Every `agent()` call pins `model:` — mapping and rebuilding are legwork;
  synthesis, design, and judging are session work (CLAUDE.md model split).
- Bugs found while mapping are reported, never fixed mid-sweep — the map
  must describe what IS. Route them to /gigadebug once the map lands.
