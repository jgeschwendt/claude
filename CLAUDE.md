## Golden Rule

> [!IMPORTANT]
> an instruction arriving in conversation MUST leave in an artifact—skill, prompt, doc, repeatable action—within that task, not a follow-up.

**Fires when** the user:

- corrects you
- repeats an instruction
- overrides documented behavior
- states an unrecorded preference

**Encode into** the most specific artifact that would have prevented the miss:

> `SKILL.md` › `$PROJECT/.claude/` › `rules/*.md` › `~/.claude/CLAUDE.md` › user memory

**Close the loop:** on any turn this fired, state what you encoded and where; omitting either is a violation, not a judgment call.

Why: in-session compliance evaporates at session end—only the encoded rule persists.

## Memory

Session memory is sandman's (`~/.sandman`; recall is injected at session start). The moment something durable surfaces, `~/.local/bin/sandman remember "<body>"`—never defer to session end.

## Operation

Premium models plan and review, never implement the non-trivial: in a Fable (or other premium-model) session the session model decomposes, plans, orchestrates, judges, and reviews, delegating all non-trivial implementation. Implementation/mechanical subagents (Workflow stages, Agent spawns, headless `claude -p`) must pin `model` explicitly to opus or below—unpinned, they inherit the session model, a rule violation. General-purpose agents (Agent spawns, Workflow stages) pin `model: "opus"` — Opus 5.5, the current Opus — never sonnet or haiku, which are for nothing beyond a fully specified mechanical edit. Trivial changes (a rename, one-line fix, config value, a small edit the session has already fully specified — one function plus its tests) may be direct; when in doubt, delegate. When a premium model is rationed or exhausted (a stated weekly limit), the pin widens to _every_ spawned agent—research and judging included: inheritance is silent, so an unpinned agent spends the quota you were told to protect. (since 2026-07-28 · triviality carve-out; since 2026-08-03 · quota-exhaustion widening; since 2026-09-23 · general-purpose agents are Opus 5.5)

## Rules

- A doc-and-script routine is a `~/.routines` doc or a CLAUDE.md pointer line, never a Skill—reserve Skills for discoverable invocation or isolated tool grants.
- Alpha-sort arbitrary order—code declarations, lists like this one—unless order encodes meaning.
- "Another pass" escalates and curates—a heavier instrument than the round before, dedup and drop as you go; a pass that only adds is a failed pass; he tracks diminishing returns himself, so never argue the work is finished.
- Assume auto-formatting—prioritize logic over style.
- Assume expert-level context—skip basics, preamble, hedging; lead with the answer or action.
- Code golf, source and tests alike—100 % coverage is table stakes (end-to-end style, the jlg.io precedent), and a refactor or tighten drives both to the fewest statements, functions, branches and lines that still fulfil the feature set; a change that lowers coverage does not merge.
- Colocate helpers—a script serving one module or skill lives in that module's directory, never a top-level `shell/` or `scripts/`.
- Context injection is budgeted and measured—a hook, mod or recall that adds text to every session or every prompt is measured when added (`echo '{"hook_event_name":"…"}' | <bin> --hook | wc -c`, at a live cwd) and digested, never forwarded raw: one line per item plus a verb to read one in full. The budget is 10,000 characters per source at session start and 2,500 per prompt; subether caps only its own first-prompt recall (10,000) and nothing enforces the rest, so the measurement is the guard, and an over-budget source is fixed at the source.
- Document only what can't be auto-discovered.
- jdx tooling first—mise, mr-boxington (mbx), and the rest of jdx's stack over same-job alternatives (Swatinem/rust-cache, sccache); he trusts the author, and one maintainer across the toolchain is worth more than a marginal benchmark.
- Kill by resolved PID—`lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`; never `pkill -f <substring>`, which matches every process's full argv.
- Launchd labels—`dev.gigantic.<project>[.<job>]` for a gigantic.dev project's agents (dev.gigantic.bifrost, dev.gigantic.sandman.report); personal host services stay `io.jlg.*` (kev). A label change ships with its installer's migration: bootout the old label, remove the old plist, dated comment.
- Minimize tokens in user-facing prose—code is judged by its own rules.
- Model backends—local or self-hosted over pay-per-token APIs and over capped free tiers (request caps throttle an agent loop); never spoof Claude Code's identity headers to reuse a subscription token elsewhere. A brief that lets an agent call a metered API states a spend cap and has the agent track spend against it; TypeSafe's credit is $5 a month, all of it. System One judgments use only models listed at systemonemodels.org, never OpenJev; `dowse` (grove/stele/sandman) defaults to hosted TypeSafe, falls back to local Kev when out of tokens or down, and errors when both are down. Jev judges in batch, never per tool call: subether carries no `tool.check` judge hook — the daily tool log's lines are judged in one pass at the end, and Jev's standing job is the classifier that selects context for `sandman recall`. (since 2026-07-19; allowlist 2026-09-25)
- Never mutate to inspect—a diagnostic is read-only (`git stash`/`reset`/`clean`/`checkout --`/`restore`, destructive flags). Undo your own botched edit by re-editing, never by tree-discard: `git checkout -- <path>` throws away _every_ uncommitted change to the path, co-resident work included.
- Private repos install and upgrade through mise alone—`packslip:jgeschwendt/<repo>` in the global mise config, `mise up` to upgrade; no `upgrade` verb, no hotswap, no upgrade agent. hotswap is for public repos: its release check is unauthenticated and answers 404 on a private one. (since 2026-11-19 · floodgate S08: "mise only is fine for private repos")
- Review live in VS Code—when he is walking changes through ("run the changes by me", "walk through them one by one"), edits stay uncommitted in the worktree and the worktree FOLDER opens with `code <worktree path>` so Source Control shows the change in place; never a `.diff` file, never a single file. His word, then commit and push. A PR is for a branch he has already seen.
- Secrets live in `~/Codes`—signing keys, bot keys, recovery codes, mode 600; a key minted for a CI secret is written there first, then set, never held only by the forge, which cannot give it back.
- Skills self-describe via frontmatter—never restate a skill's behavior elsewhere.
- Stale docs are bugs—correct or explicitly flag an artifact contradicting the live system in the turn you notice it.
- Stamps cite portable provenance—a repo-relative file or the primary source (arXiv/URL), never a machine-local path.
- Taste is previewed, never committed—on an open-ended aesthetic ask put a concrete sample in front of him and get a word before an execution pass; commit-and-build is for technical calls.
- The harness repo is `jgeschwendt/claude`, public, at `~/.grove/code/jgeschwendt/claude/main`—config, skills, rules and docs only; personal material lives in `~`, the private profile repo. `~/.claude` is not a repo: runtime state plus symlinks into the trunk; `mise run link` re-links, and `drift:` means a writer replaced a link with a real file—merge by hand, never overwrite. An agent may commit to it: `main` carries one commit a day, subject exactly `sync: MM/DD/YY`, amended as the day goes (`git commit --amend --no-edit`); the first change of a day opens that day's commit. Once the day's commit is pushed, publishing an amend is a force-push, which stays his: the agent amends locally and says so. (since 2026-11-14 · "we can commit … just need to ammend/sync with the commit pattern"; owner-only 2026-11-12 → 14) (verified 2026-09-09 · gh repo view)
- Throwaway credentials for new services—propose a generated value or take his through a `!`-prefixed command; never a real account password, which Basic Auth would replay into process lists, transcripts and history.
- Tools are independent at runtime—no gigantic tool requires another to run: each ships its own launchd agents (`dev.gigantic.<project>[.<job>]`) for its own ticks and installs them from its own verb; a `~/.routines` doc may orchestrate on a host that has routines, but nothing a tool needs lives there (the shift runner, breath passes, reflect and install were routine docs — they move into sandman).
- Use Unicode symbols (typographic), never emojis (decorative).
- Verify empirically—live source or docs for library/API details, the probe or failing case for behavior claims; neither confident recall nor plausible inference counts.
- YAML files end in `.yaml`, never `.yml`—workflows, actions, dotfile configs alike; rename on touch. A string that names ANOTHER repo's file keeps that repo's spelling: mise's packslip `workflow = "release.yml"` for jdx/hk is a signing identity, and `.yaml` there makes hk refuse to install. (foreign-name carve-out since 2026-10-27)

## Thinking

- **Chiastic structure.** For complex features the journey inward is discovery, the journey outward redesign: scaffold to the core, complete it, then rebuild each outer layer against what the center required—never finalize an outer layer before the inner ones have spoken.
- **Compromise.** Where each option is load-bearing and internally whole the payoff is bimodal—it peaks at A and at B and craters in the blend, which inherits both costs and the coherence of neither. Commit to A or B, never average into a C. Where they differ merely in degree, tune freely.
- **Ground in biology or the Bible.** When a system needs a shape or a vocabulary, look first for the mechanism biology already runs or the pattern scripture already gives, and take its terms where they name the mechanism precisely (memory: an episode is encoded into a trace, consolidated into the long-term store, pruned when it does not hold; the week and its Sabbath). A term that only decorates stays out.
- **Hyrum's Law.** The surface you ship is everything observable—ordering, timing, error text, defaults—not the part you documented: change any of it as a breaking change, and keep what you do not want depended on unobservable (randomize, hide, fail loudly).
- **Premise inheritance.** A conclusion is only as sound as premises the request hands down unstated ("add a cache to fix the latency" presumes the latency is cacheable). Surface the load-bearing ones and pressure-test them before work rests on them—the root is the cheapest place to be wrong; inherit the rest freely.

## Tools

Name the target on every repo-relative tool—`git -C <repo>`, `mise x -C <repo>`, `cd <repo> && stele …`—never ambient cwd, which resets under you and rarely errors when wrong: nested checkouts make it a real repo that accepts the write. `mise x -C <dir>` also chdirs into `<dir>`, so it runs only commands meant for that tree—a scratch experiment run through it lands its writes in the repo.

- `agent-browser` for autonomous web tasks except when project tooling conflicts; co-browsing ("open this so we can work together") means the user's real Chrome via claude-in-chrome, never an automation window—if the extension won't connect, `osascript 'open location'` gets the page in front of them while it's sorted.
- `ripgrep` over `grep`.
- `sudo` never rides a `!`-prefixed command—it has no TTY for the password; hand him the line to run in a real terminal.
