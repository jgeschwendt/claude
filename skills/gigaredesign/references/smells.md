# Architecture Smell Lens Catalog — MAP phase

Hunt lenses for the MAP phase. Mapping subagents (opus-pinned) cite an entry as a lens and return every instance with its detection-signal output attached; the session-model judge uses the severity threshold to accept, reject, and rank what the redesign must fix. Component/module scale only — never method-level.

Each entry carries: definition · detection signal (runnable where a command exists, else the observable pattern) · severity threshold · addressing move (→ `moves.md`).

Check tool availability before briefing (`which <tool>` / a `bunx <pkg> --version` dry-run); a missing tool downgrades the entry to its described observable pattern — never silently skip the lens.

A smell is a surface indicator of a deeper structural problem, not a defect proof — an instance below its severity threshold is noise; report it as such (per https://martinfowler.com/bliki/CodeSmell.html, verified 2026-07-15).

## Dependency-graph shape

**Cyclic dependency** — two or more modules reach each other transitively; no acyclic layering exists, so nothing in the cycle can be understood, tested, or moved alone.

- Detect · JS/TS: `bunx madge --circular --extensions ts,tsx src` · Elixir: `mix xref graph --format cycles --fail-above 0` · Rust: `cargo modules dependencies --lib --acyclic`.
- Severity · ANY cycle spanning ≥2 named subsystems is a fix; a 2-file cycle inside one leaf module is low.
- Move · → moves.md: dependency inversion at the boundary; extract module (the shared kernel both sides depend on).
- (mix flag per https://hexdocs.pm/mix/Mix.Tasks.Xref.html; cargo flag per https://github.com/regexident/cargo-modules — both verified 2026-07-15)

**God component / hub** — one module carries high fan-in AND high fan-out at once: everything depends on it and it depends on everything, so it cannot change or move in isolation.

- Detect · build the module dep graph (`madge --json`, `mix xref graph --format dot`, `cargo modules dependencies --lib`), rank nodes by (Ca × Ce); the top outlier is the hub.
- Severity · fix when one module sits in the top 5% of both Ca and Ce, or its removal would disconnect the graph.
- Move · → moves.md: split module by client; extract interface/behaviour (one per client role).

**Unstable-dependency violation** — a stable, widely-depended-on module depends on a volatile one, so churn in the leaf forces recompile/redeploy of the core.

- Detect · compute instability I = Ce/(Ce+Ca) per module (Ca = inbound module count, Ce = outbound); flag any edge A→B where I(A) < I(B) — a stable module pointing at a less-stable one.
- Severity · fix when the target's I exceeds the depender's by >0.3, or the target also scores high on churn.
- Move · → moves.md: dependency inversion at the boundary (abstraction owned by the stable side).
- (I, Ca, Ce, main-sequence D = |A+I−1| per https://en.wikipedia.org/wiki/Software_package_metrics, verified 2026-07-15; Agile Software Development, Principles, Patterns, and Practices, Martin)

**Leaky boundary / deep-import bypass** — callers import a module's internal files directly instead of its public surface, so the boundary constrains nothing and internals can't move.

- Detect · `rg -n "from ['\"].*/(internal|lib|_)/" src`, or grep imports reaching past the package index / `mod.rs` / context module into nested paths; Elixir: `App.Sub.Impl.*` calls from outside `App.Sub`.
- Severity · fix when >3 external call sites bypass the intended entry, or any bypass crosses a subsystem line.
- Move · → moves.md: encapsulate module (publish the surface, migrate deep imports, seal internals last).

**Dead component** — a module with no inbound dependencies and no entry point (not a CLI target, route, test root, or public export): pure carrying cost.

- Detect · JS/TS `bunx knip` or `bunx ts-prune` for unused exports/files; Elixir: per candidate file `mix xref graph --sink <file> --only-nodes` — empty output means nothing references it (or compute in-degree 0 from `mix xref graph --format dot`); check dynamic/reflective loads before condemning.
- Severity · fix once confirmed reachable-from-nothing.
- Move · no move — SKILL.md disposition `deleted-with-reason` (verify reachability incl. dynamic loads, then remove).

**Layering violation / dependency-rule inversion** — a dependency points the wrong way across an architectural boundary: a lower/inner layer calls an outer one, or a call skips a layer entirely, collapsing the intended direction of dependency.

- Detect · assign each module a layer (domain / application / infrastructure / UI), then scan the dep graph for edges pointing inward-to-outward or across-skipping; `madge --json` / `mix xref graph` output filtered against a layer map. dependency-cruiser (`bunx dependency-cruiser --config`) can encode and check layer rules directly.
- Severity · fix ANY inner→outer edge (violates the dependency rule); a layer-skip is medium unless it crosses a subsystem.
- Move · → moves.md: dependency inversion at the boundary (abstraction owned by the inner layer); seam where a layer was skipped.
- (Clean Architecture — the Dependency Rule, Martin)

## Change history (git-derived)

Gate this section on history depth first: `git rev-list --count HEAD -- <scope>` —
squashed, freshly-imported, or single-commit histories make every co-change lens
return uniform noise (every pair "co-changes" in the one commit). Below ~50 scoped
commits in the window, mark these lenses unavailable in the map rather than
reporting garbage as signal.

**Shotgun-surgery hotspot** — one logical change forces edits across many modules because a concern is smeared over them; the inverse of divergent change.

- Detect · co-change coupling from `git log --since=12.month --pretty=format: --name-only`; count commits where file pairs change together, flag cross-module pairs/clusters that co-change in a high fraction of their commits.
- Severity · fix when a cluster of ≥3 cross-module files co-changes in >60% of the commits touching any of them.
- Move · → moves.md: move responsibility (gather the concern's fragments) · combine modules when whole components co-change.
- (Shotgun Surgery — Refactoring, 2nd ed., Fowler)

**Churn × complexity hotspot** — a file both changed often and structurally complex; the intersection is where defects and rework concentrate.

- Detect · churn = `git log --since=12.month --pretty=format: --name-only | sort | uniq -c | sort -rn`; complexity ≈ LOC or cyclomatic per file (`scc --by-file`, `tokei`, eslint complexity rule); rank by churn × complexity.
- Severity · fix the top handful where both axes are high-percentile; high-churn-low-complexity is fine, low-churn-high-complexity can wait.
- Move · → moves.md: extract module (carve the volatile edge from the stable core).
- (Your Code as a Crime Scene, Tornhill)

**Divergent change** — one module changes for many unrelated reasons (new report format AND new tax rule AND new auth backend all edit it): it holds multiple responsibilities.

- Detect · cluster the module's commit messages / touched-line regions by theme; if edits partition into disjoint reason-sets, it's divergent.
- Severity · fix when ≥3 distinct change reasons repeatedly land in one module.
- Move · → moves.md: extract module (one component per reason-to-change).
- (Divergent Change — Refactoring, 2nd ed., Fowler)

## Cohesion & coupling semantics

**Feature envy at module scale** — a module's logic mostly reads/mutates another module's data or state, sitting on the wrong side of the boundary.

- Detect · per module, ratio of outbound calls/field-accesses into one specific other module vs. its own internals; a high external-to-internal ratio toward a single target signals misplacement.
- Severity · fix when >50% of a module's operations manipulate a single foreign module's state.
- Move · → moves.md: move responsibility (behavior to the data it envies).
- (Feature Envy — Refactoring, 2nd ed., Fowler)

**Scattered concern** — a single cross-cutting concern (auth, logging, caching, validation, currency) implemented in fragments across many modules with no owner.

- Detect · `rg -l "<concern-token>" src | wc -l` across the concern's vocabulary; concern present in many modules yet encapsulated by none.
- Severity · fix when the concern appears in >5 modules with no canonical module owning it.
- Move · → moves.md: extract module (the concern gets one owner); move responsibility for each fragment.

**Hidden temporal / shared-state coupling** — modules are coupled invisibly through a shared mutable global, singleton, or ambient context, with a required call ordering the type system never expresses (connascence of execution order, at a distance).

- Detect · locate shared mutable singletons/globals (`rg` module-level mutable state, process dictionary, DI container mutation, `Application.put_env` at runtime); flag modules that read state another module must have written first.
- Severity · fix when ≥2 modules depend on an unstated write-then-read ordering across a boundary, or a shared global has >3 distinct writers.
- Move · → moves.md: move responsibility (state to a single owner); seam where the ordering must become explicit.
- (Connascence of Execution — https://connascence.io, verified 2026-07-15)

**Wrong-abstraction accretion** — shared code grown parameter-riddled and flag-driven to serve callers whose needs actually diverged; every caller pays for every branch.

- Detect · shared utility/base whose signature carries mode flags/enums/optional bags, with `if mode ==` / `case`-per-caller bodies; count boolean+enum params and per-caller branches.
- Severity · fix when a shared unit has ≥3 caller-discriminating flags or a branch-per-consumer body.
- Move · → moves.md: inline module back to callers, then extract module for the genuinely common core.
- ("duplication is far cheaper than the wrong abstraction", https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction, Metz, verified 2026-07-15)

**Speculative generality at module scale** — a module carries abstraction, extension points, or configuration for cases that never arrived: sole-implementation interfaces, unused plugin registries, parameters only ever passed one value.

- Detect · interfaces/traits/behaviours with exactly one implementer (`rg` the impl sites); config keys and hooks with a single call-through; registries with one entry. `bunx knip` flags unused exports that back these seams.
- Severity · fix when generality machinery has zero second consumer after a full-history scan and no committed near-term need.
- Move · → moves.md: inline module (collapse the abstraction to its single caller, delete the unused seam).
- (Speculative Generality — Refactoring, 2nd ed., Fowler)

## Duplication

**Semantic duplication** — the same logic realized in multiple modules; divergent copies drift and must be fixed in parallel.

- Detect · `bunx jscpd src --min-tokens 50 --reporters console` catches type-1 (identical) and type-2 (renamed) clones. Type-3 (gapped) and type-4 (equivalent logic, different syntax) are INVISIBLE to token tools — surface them by reading co-located siblings or embedding-similarity over function bodies, and mark them read-derived, not tool-derived.
- Severity · fix a clone set of ≥2 copies spanning modules or exceeding ~40 lines; incidental short clones are noise.
- Move · → moves.md: extract module (hoist the shared logic); sprout module when copies must converge on new code.
- (Duplicated Code — Refactoring, 2nd ed., Fowler)
