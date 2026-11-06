# Migration moves

The move vocabulary for the PLAN phase. Every plan stage names its moves; a stage
that can't name its move is improvising — and improvised structural change is how a
staged rebuild quietly stops being always-green. Compose stages from these; cite them
by name in implementation briefs.

Attribution: names stamped `(per <url>, verified 2026-07-15)` are canonical catalog
entries. Feathers material cites _Working Effectively with Legacy Code, Feathers_.
Names presented without a stamp are descriptive, not canonical — use them, but don't
attribute them.

---

## 1 · Module-scale restructuring

Fowler's refactoring catalog lifted from function/class scale to component scale. The
mechanics transpose directly; the blast radius is larger, so the green-keeping trick
matters more.

- **Extract module** — pull a coherent responsibility out of a host component into its
  own component; host imports it back. `(per https://refactoring.com/catalog/, verified
  2026-07-15 — Extract Function / Extract Class at component scale)`
  · **use when** map shows a responsibility with its own client set tangled inside a
  larger component; design gives it a home of its own.
  · **stays green by** moving code verbatim first, re-exporting from the old path so
  callers don't move yet — behavior is byte-identical, only location changed.
  · **watch for** dragging shared mutable state across the new boundary; extract the
  state's owner first or you split one responsibility into two authorities.

- **Inline module** — fold a component whose existence no longer earns its seam back
  into its sole caller. `(per https://refactoring.com/catalog/, verified 2026-07-15 —
  Inline Function / Inline Class at component scale)`
  · **use when** a component has one client and adds only indirection; design collapses
  the layer.
  · **stays green by** inlining the body at the one call site, then deleting the shell —
  no third party observed the boundary, so nothing external changes.
  · **watch for** inlining something with more clients than the map showed; grep/LSP the
  full reference set before you delete the seam.

- **Move responsibility** — relocate a function or a whole responsibility from one
  component to the one that should own it. `(per https://refactoring.com/catalog/,
  verified 2026-07-15 — Move Function / Move Field)`
  · **use when** a behavior lives where it's called from, not where it belongs; design
  reassigns ownership.
  · **stays green by** leaving a thin delegating forwarder at the old site during the
  stage, deleting it only once callers are migrated (this is parallel change, below).
  · **watch for** moving the function but not its data dependencies — you trade a
  misplaced function for a chatty cross-component call.

- **Split module by client** — divide one component into per-client-set components when
  distinct consumers use disjoint slices of it.
  · **use when** the map shows two client cohorts touching non-overlapping surfaces of
  one component; design serves them separately.
  · **stays green by** splitting the implementation behind the existing facade first,
  then migrating each cohort to its own component — the facade holds the contract steady
  through the cut.
  · **watch for** a shared core hiding between the two slices; extract that core as its
  own component before splitting, or you duplicate it.

- **Combine modules** — merge components that always change together into one.
  `(per https://refactoring.com/catalog/, verified 2026-07-15 — Combine Functions into
  Class / into Transform)`
  · **use when** map shows shotgun-surgery coupling — every change to A forces a change
  to B; design unifies them.
  · **stays green by** merging into one component while keeping both old public paths as
  re-exports, then migrating callers, then collapsing the paths.
  · **watch for** combining components that share change history but not responsibility —
  temporal coupling isn't structural belonging.

- **Rename-and-relocate** — give a component its right name and its right location in one
  move. `(per https://refactoring.com/catalog/, verified 2026-07-15 — Change Function
  Declaration / Rename Field / Rename Variable)`
  · **use when** design's names and homes diverge from the current tree.
  · **stays green by** using LSP/tooling rename, not grep — the language server updates
  every typed reference atomically; grep misses dynamic references and hits strings and
  comments it shouldn't. Where no LSP exists, a compiler/typechecker is the backstop.
  · **watch for** dynamic references LSP can't see — reflection, string-keyed dispatch,
  config files, route tables; enumerate these by hand before the rename.

- **Encapsulate module** — introduce an explicit public surface and route all access
  through it, killing deep imports into internals. `(per https://refactoring.com/catalog/,
  verified 2026-07-15 — Encapsulate Variable / Encapsulate Record at component scale)`
  · **use when** map shows callers reaching into a component's guts; design demands a
  narrow contract before anything can be restructured behind it.
  · **stays green by** publishing the intended surface, then migrating deep imports to it
  one caller at a time, then sealing internals last — each step keeps every path working.
  · **watch for** sealing internals before every deep import is migrated; the surface
  isn't done until the grep for deep paths comes back empty.

---

## 2 · Dependency-breaking / seam work

Feathers' techniques for changing behavior at a boundary without editing the code on the
far side of it. These create the places a restructuring move can act. All cite
_Working Effectively with Legacy Code, Feathers_ unless stamped otherwise.

- **Seam** — a place where you can alter behavior without editing the code there, by
  changing what's invoked at an enabling point. (Feathers)
  · **use when** you need to substitute a new structure for an old one but can't touch
  every call site at once — find or create the seam first.
  · **stays green by** definition: the seam is the point where substitution is invisible
  to callers, so swapping behind it preserves the observed contract.
  · **watch for** declaring a seam where there's a hard-coded `new`/direct construction —
  that's not a seam until you introduce an enabling point (inject, extract-interface).

- **Extract interface / behaviour** — pull an explicit contract type out of a concrete
  implementation so alternatives can stand in. (Feathers — _Extract Interface_; note:
  not a second-edition catalog entry, so descriptive here, not attributed to
  refactoring.com)
  · **use when** design needs two implementations (old + new) to coexist behind one type.
  · **stays green by** deriving the interface from the existing concrete type's used
  surface, then having the original implement it — nothing changes behavior, you've only
  named the contract. Realizations: Elixir behaviours (`@callback` + Mox for test
  doubles), TypeScript `interface`, Rust traits.
  · **watch for** extracting the whole surface instead of only what clients use — a fat
  interface locks in the coupling you meant to break.

- **Sprout module** — write the new behavior as a new component in the target structure;
  the old code calls into it. (Feathers — _Sprout Method / Sprout Class_ at component
  scale)
  · **use when** you can't safely restructure the old component yet, but new work can be
  born correct; design's target shape exists for the new slice.
  · **stays green by** adding net-new code the old path delegates to — the existing code
  is called, not edited, so its behavior is untouched.
  · **watch for** the sprout quietly duplicating logic that should have been extracted
  from the old component — sprout is for genuinely new behavior, not a copy.

- **Wrap module** — put a new component around an old one to add or redirect behavior
  without editing the original. (Feathers — _Wrap Method / Wrap Class_)
  · **use when** you need cross-cutting behavior (logging, adaptation, gating) around an
  untouchable component; design inserts a layer.
  · **stays green by** the wrapper delegating to the unchanged original for the core path
  — the original's contract passes through intact.
  · **watch for** wrappers accreting logic until they're a second authority; a wrapper
  adapts, it doesn't own the responsibility.

- **Adapter / anti-corruption layer** — a translation boundary between old and new
  structure so each keeps its own model. (Adapter — GoF; anti-corruption layer — Evans,
  DDD; both descriptive here)
  · **use when** old and new structures must interoperate mid-migration but have
  divergent models; design keeps the new model clean.
  · **stays green by** confining all old↔new translation to one component, so neither
  side's model leaks into the other and both stay independently correct.
  · **watch for** the ACL becoming permanent because no stage ever schedules its removal;
  name its deletion as a contract-phase step when the old side dies.

- **Dependency inversion at the boundary** — make both old and new depend on an
  abstraction owned by the consumer, not on each other. (Descriptive — DIP)
  · **use when** the seam sits at a component boundary and you want the new structure to
  not know about the old.
  · **stays green by** introducing the abstraction and pointing the existing dependency
  at it before adding the new implementation — a pure indirection step, no behavior
  change.
  · **watch for** placing the abstraction on the supplier's side; it must be owned by the
  consumer or you've inverted nothing.

---

## 3 · Whole-migration patterns

The stage-spanning shapes. A single stage usually rides one of these; a full rebuild is
a sequence of them.

- **Strangler fig** — grow the new structure around the old, moving responsibilities
  across until the old is dead and removed. `(per
  https://martinfowler.com/bliki/StranglerFigApplication.html, verified 2026-07-15)`
  · **use when** the whole component/app must be replaced but a big-bang cutover is too
  risky; design lets responsibilities migrate one at a time.
  · **stays green by** a transitional routing layer that sends each responsibility to old
  or new — every request is served throughout; value ships before the migration finishes.
  · **watch for** the strangler stalling half-done — old and new both live forever
  because no one funds the last responsibilities; every stage must retire something.

- **Branch by abstraction** — insert an abstraction over the thing being replaced, build
  the new implementation behind it, switch, then delete the old. `(per
  https://martinfowler.com/bliki/BranchByAbstraction.html, verified 2026-07-15)`
  · **use when** an internal component with many clients must be swapped while the
  codebase stays continuously buildable and releasable.
  · **stays green by** the system building and running correctly at all times — all
  clients go through the abstraction, both implementations coexist behind it, switching
  is incremental.
  · **watch for** clients that must switch simultaneously (shared state, ordering) — some
  suppliers can't be migrated gradually; identify these before committing to the pattern.

- **Expand-and-contract / parallel change** — add the new form alongside the old (expand),
  migrate every consumer (migrate), remove the old (contract). `(per
  https://martinfowler.com/bliki/ParallelChange.html, verified 2026-07-15)`
  · **use when** a published contract (API, schema, signature) must change without a
  flag-day break to consumers.
  · **stays green by** the interface supporting both old and new simultaneously across the
  migrate phase — no consumer breaks because its version never disappears under it.
  · **watch for** skipping contract — a permanent expand phase leaves two authoritative
  forms and consumer confusion about which is current. Every expand schedules its contract.

- **Parallel run / dark launch** — run old and new structures on the same inputs, compare
  outputs, promote when they agree. (Descriptive; consistent with parallel-run practice)
  · **use when** correctness of the new structure is uncertain and mismatch is expensive;
  design tolerates running both live.
  · **stays green by** the old structure remaining authoritative — new runs in shadow, its
  output compared and logged, never served — until agreement clears the bar.
  · **watch for** side effects in the shadow path (writes, notifications, charges) — a
  dark launch must be read-only or its effects double.

- **Feature-toggle structure swap** — guard the old-vs-new structure choice behind a
  toggle so the switch is a config flip, reversible instantly. (Descriptive; toggle
  practice, complements branch-by-abstraction)
  · **use when** you want the cutover decoupled from deploy and instantly revertible.
  · **stays green by** both structures shipping in the binary; the toggle selects at
  runtime, so rollback is a flag flip, not a redeploy.
  · **watch for** toggles outliving their migration — a dead toggle is two live code paths
  no one tests; schedule its removal in the contract phase.

- **Characterization-test harness first** — before moving anything, pin current behavior
  with tests written at the boundary you're about to restructure. (Feathers —
  _characterization tests_)
  · **use when** the map reveals under-specified behavior — you don't fully know what the
  old structure does, so you can't prove the new one matches.
  · **stays green by** capturing actual current outputs as the assertion baseline (not
  intended behavior) so any behavior drift during the move fails a test immediately.
  · **watch for** asserting what the code _should_ do — characterization tests pin what it
  _does_, bugs included; fix behavior in a separate, labeled stage, never silently mid-move.

---

## Composing stages

- Order by dependency direction — dependencies before dependents: a component
  restructures only after the components it depends on have their target shape, so it
  lands on stable ground. Exception: a strong seam (branch by abstraction, ACL) lets you
  cut higher first by decoupling the dependent from the still-unshaped dependency.
- Every stage is expand → migrate callers → contract: introduce the new form, move
  consumers across, remove the old. A stage that only expands is unfinished.
- Never leave both structures authoritative for the same responsibility across a stage
  boundary — one owner per responsibility at every green checkpoint; parallel forms are
  fine only while one is provably shadow/deprecated.
- Each stage ends green and shippable: full regression passes, external behavior
  unchanged, commit the checkpoint. The commit is the rollback floor for the next stage.
- Unordered sibling stages own disjoint file sets — two extractions from one host both
  rewrite the host even though neither depends on the other; overlap forces an explicit
  ordering edge and the later brief is authored against the earlier stage's output.
- Name the move(s) each stage uses in its brief. If no name fits, the stage is
  under-designed — split it or find the seam before you build.
