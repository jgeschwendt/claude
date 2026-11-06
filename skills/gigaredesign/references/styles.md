# Architecture Styles — candidate-generation palette

Organizing principles for WHOLE candidate designs in the REIMAGINE phase. Each candidate commits to ONE principle top-to-bottom — never blend two into a hybrid (the skill forbids it). A style earns its place because the component map's evidence fits it, not because it is fashionable. Read `fits when`/`fights when` as mechanical tests against the map: dependency graph, responsibility inventory, state ownership, churn data. Grand styles (event-driven, CQRS, actor) buy scaling and decoupling with real coordination overhead — make them prove the map demands it.

---

## Layered (technical-concern strata)

Stack the system into presentation → domain → data, each layer depending only downward.

- **fits when**
  - dependency graph already sorts cleanly into technical tiers with few upward edges
  - one domain, or domain logic thin relative to I/O plumbing
  - multiple presentations (web, API, batch) share one core
- **fights when**
  - churn data shows most changes touch all layers at once (a field added end-to-end) — the seams run across the grain of change
  - many distinct domains, so a single "domain layer" becomes a junk drawer
  - state ownership is per-feature, not per-tier
- **canonical seam** · extract the data-access layer behind repository interfaces first — fewest upward callers, most stable contract.
- **migration cost profile** · cheap to introduce (mechanical file moves, interface extraction); expensive to keep honest — cross-layer changes stay costly forever, the reason to reject it when churn cuts vertically.
- Layering by technical concern should not be the _highest_-level split for a multi-domain system — domain modules internally layered scale better (per https://martinfowler.com/bliki/PresentationDomainDataLayering.html, verified 2026-07-15).

## Hexagonal / ports-and-adapters

An isolated application core surrounded by ports (interfaces it owns) with technology-specific adapters plugged in; intent: "allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases."

- **fits when**
  - business logic is tangled into I/O (framework, DB, UI) and the map shows core rules that _want_ isolated testing
  - multiple driving actors already exist (HTTP + CLI + cron hitting the same logic)
  - you need to swap a driven dependency (DB, external service) or mock it in tests
- **fights when**
  - the system is mostly glue with little core logic to protect — ports add ceremony around nothing
  - a single actor, single DB, no swap pressure and none foreseeable
  - the "core" would be anemic (all data, no behavior)
- **canonical seam** · define the driven (secondary) persistence port first and route the core through it; the primary/driving side follows once the core no longer imports framework types.
- **migration cost profile** · cheap where core logic is already cohesive (wrap it in a port); expensive where logic is smeared through controllers/ORM entities — you pay to disentangle before any port helps.
- Primary/driving adapters initiate; secondary/driven adapters respond — the distinction tells you which side to invert first (per https://alistair.cockburn.us/hexagonal-architecture/, verified 2026-07-15).

## Modular monolith (domain modules behind explicit public surfaces)

One deployable, partitioned into domain modules that expose a narrow public API and hide internals; cross-module calls go only through published surfaces.

- **fits when**
  - the map reveals 3–8 natural domain clusters (bounded contexts) with dense internal edges and sparse edges between them
  - state ownership already aligns to those clusters (each owns its tables)
  - team wants service-like isolation without the distributed-systems tax
- **fights when**
  - no clear domain seams — the graph is a uniform mesh with no low-cost cut
  - a single tightly-coupled domain (splitting it invents fake boundaries)
  - cross-module chatter so high that "public surfaces" would expose nearly everything
- **canonical seam** · pick the module with the cleanest existing boundary (fewest inbound edges), wall it behind a facade, forbid deep imports; repeat outward.
- **migration cost profile** · cheap relative to microservices (no network, no separate deploy); the expense is enforcing surfaces — needs module-boundary lint or the walls erode.
- Almost all successful service splits started as a monolith that grew too big and was broken along boundaries discovered through real use — start here and extract later, don't distribute up front (per https://martinfowler.com/bliki/MonolithFirst.html, verified 2026-07-15).

## Vertical slice / feature folders

Organize by feature/request, each slice owning its full stack front-to-back; "minimize coupling between slices, and maximize coupling in a slice."

- **fits when**
  - churn data shows changes arrive as whole features (a request end-to-end), rarely as horizontal layer sweeps
  - features are largely independent — little shared domain logic between them
  - team has refactoring discipline to catch cross-slice duplication
- **fights when**
  - heavy shared logic across features — slices would duplicate or fight over a common core
  - the team lacks discipline to keep slices honest (drifts to chaos)
  - architectural uniformity is a hard requirement (regulated, many hands)
- **canonical seam** · carve one high-churn feature into a self-contained slice (its own handler, model, persistence path) and prove it changes without touching siblings; migrate feature by feature.
- **migration cost profile** · cheap to start incrementally (one slice at a time, no big-bang); expensive if real shared logic exists — you either duplicate it or reintroduce a layer, undercutting the style.
- Assumes mature practice; without refactoring discipline it degrades (per https://www.jimmybogard.com/vertical-slice-architecture/, verified 2026-07-15).

## Event-driven (pub-sub backbone)

Components communicate by publishing events to a shared bus; subscribers react, with no direct calls between producers and consumers.

- **fits when**
  - the map shows one action fanning out to many independent reactions (order placed → notify, bill, ship, log)
  - producers and consumers change on different schedules and shouldn't know each other
  - eventual consistency is acceptable for the flows in question
- **fights when**
  - flows are request/response needing an immediate answer — events invert control and scatter the logic
  - the map shows mostly linear call chains with no fan-out
  - you need a synchronous transaction across steps (events trade that for eventual consistency)
- **canonical seam** · pick one high-fan-out write, publish a domain event there, move one consumer to subscribe; the direct call stays until the subscriber proves out (strangler cutover per topic).
- **migration cost profile** · cheap to add one event alongside existing calls; expensive operationally — you inherit atomicity problems (update DB and publish together, needing outbox/event-sourcing) and cross-hop debugging.
- Programming model gets more complex and demands patterns like Transactional Outbox to publish atomically — make the fan-out real before paying this (per https://microservices.io/patterns/data/event-driven-architecture.html, verified 2026-07-15).

## Pipeline / dataflow (pipes and filters)

Decompose processing into a linear chain of stages, each transforming a stream and passing it on; stages are independent and composable.

- **fits when**
  - the map's core responsibility is transformation — input flows through recognizable stages (parse → validate → enrich → emit)
  - stages have single responsibilities and share only the data passing between them
  - you want to reorder, insert, or parallelize stages
- **fights when**
  - the domain is interaction/state-heavy, not flow-heavy — a pipeline hides the real logic
  - stages need rich back-and-forth or shared mutable state
  - error handling must branch richly rather than short-circuit a stream
- **canonical seam** · isolate the first pure stage (a transformation with clear in/out types) behind a stage interface; grow the chain by extracting adjacent transforms.
- **migration cost profile** · cheap when the code is already a sequence of transforms (rename to stages); expensive when logic is entangled with state or control flow that resists linearization.
- Canonical "Pipes and Filters" pattern — _Pattern-Oriented Software Architecture, Vol. 1_ (Buschmann, Meunier, Rohnert, Sommerlad, Stal).

## Plugin kernel (microkernel)

A minimal core provides the stable mechanism and extension points; all volatile/optional capability lives in plugins registered against those points.

- **fits when**
  - the map separates cleanly into a small invariant core and many variant features that come and go
  - churn concentrates in the plugins while the core is stable
  - third parties or teams need to extend without touching the core
- **fights when**
  - features are deeply interdependent — no clean core/plugin cut exists
  - the "core" would end up holding most of the logic (plugins are cosmetic)
  - everything changes together, so the stability gradient the pattern needs isn't there
- **canonical seam** · define the plugin contract and extract one existing feature to load through it, proving the core needs no edit to add the next; migrate features into plugins one at a time.
- **migration cost profile** · cheap to add a plugin once the contract exists; expensive to design that contract right — a wrong extension point forces churn back into the core, defeating the style.
- Microkernel/plugin pattern — _Software Architecture Patterns_ (Mark Richards, O'Reilly).

## Actor / process-supervision (OTP-style)

Model the system as isolated processes that own their state and communicate only by message, arranged under supervision trees that restart failed processes.

- **fits when**
  - state ownership in the map is naturally per-entity/per-session (each thing is its own little state machine)
  - concurrency and fault-isolation are first-order concerns — one failure must not corrupt the rest
  - Elixir/Erlang/BEAM (or an actor runtime) is the target — the style is native, not bolted on
- **fights when**
  - logic is a synchronous, shared-state transaction — messages add latency and reordering hazards
  - state is one big shared store, not partitionable into independent owners
  - single-threaded, low-concurrency workloads where processes are pure overhead
- **canonical seam** · give one stateful entity its own process (GenServer) owning what was shared mutable state, put it under a supervisor, route access through messages; migrate entity types one at a time.
- **migration cost profile** · cheap on the BEAM where supervision is idiomatic; expensive to reason about message ordering, backpressure, and once-shared invariants now split across mailboxes.
- Actor model — Hewitt; supervision-tree practice — _Designing for Scalability with Erlang/OTP_ (Cesarini & Vinoski), _Programming Elixir_ (Thomas).

## CQRS (command-query responsibility segregation)

Split the write model from the read model so each is shaped for its job; they may live in separate stores.

- **fits when**
  - the map shows read and write logic genuinely diverging — different shapes, different invariants
  - read and write loads differ enough to scale independently
  - applies to ONE bounded context under real load, never system-wide
- **fights when**
  - reads and writes use essentially the same model (most CRUD) — separation adds pure complexity
  - the domain is simple and updated the way it's read
  - applied broadly as an aspiration rather than to a proven hotspot
- **canonical seam** · introduce a dedicated read model (projection) for one heavy query path, leaving writes untouched; only split the write model if command logic actually diverges.
- **migration cost profile** · cheap for one read projection; expensive for full separation — dual models, synchronization, and eventual-consistency handling.
- WARNING — overkill for most systems: "the majority of cases I've run into have not been so good, with CQRS seen as a significant force for getting a software system into serious difficulties"; use it only for a specific bounded context, never as a top-level style, and be very cautious (per https://martinfowler.com/bliki/CQRS.html, verified 2026-07-15).

## Null style (keep current structure)

The always-present candidate: the map's existing structure, with only local fixes, is the baseline every reimagined design must beat. See SKILL.md step 3 — a redesign that doesn't clearly outscore this on the map's own evidence does not ship.

---

## Choosing

- Rank candidates by fit to the map's ACTUAL responsibilities and state ownership, not to an aspiration — a style that flatters where the code is going but not where it is loses.
- Weigh migration cost: a style with a clean strangler seam and cheap incremental cutover beats a theoretically purer one that demands a big-bang rewrite.
- Weight seam quality explicitly — the staged rebuild lives or dies on being always-green, so a style whose first cut is low-risk and independently verifiable ranks above one whose seams all tangle.
- Read `fights when` as a veto, not a discount: one clear structural mismatch (churn cuts across the style's grain, no clean boundary exists) disqualifies a candidate outright.
- For most small/mid codebases the real winner is **modular monolith** or **vertical slice** — they match how such systems actually change and carry the least coordination tax.
- Event-driven, CQRS, actor, and microkernel must earn their overhead from a specific map signal (real fan-out, diverging read/write load, per-entity state, a stable core/plugin gradient) — absent that signal, they lose to the simpler split and to the null style.
