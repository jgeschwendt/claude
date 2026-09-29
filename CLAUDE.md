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

- A doc-and-script routine is a `~/.routines` doc or a CLAUDE.md pointer line, never a Skill—reserve Skills for discoverable invocation or isolated tool grants. (since 2026-07-30 · "i don't want a skill, remove this")
- Alpha-sort arbitrary order—code declarations, lists like this one—unless order encodes meaning.
- "Another pass" escalates and curates—a heavier instrument than the round before, dedup and drop as you go; a pass that only adds is a failed pass; he tracks diminishing returns himself, so never argue the work is finished. (since 2026-08-26)
- Assume auto-formatting—prioritize logic over style.
- Assume expert-level context—skip basics, preamble, hedging; lead with the answer or action.
- Colocate helpers—a script serving one module or skill lives in that module's directory, never a top-level `shell/` or `scripts/`. (since 2026-07-21 · ~/.claude/shell moved under the dissolve skill)
- Document only what can't be auto-discovered.
- Kill by resolved PID—`lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`; never `pkill -f <substring>`, which matches every process's full argv. (since 2026-07-29 · a port-number pattern killed a Chrome renderer; a name fragment nearly took a live dev session)
- Minimize tokens in user-facing prose—code is judged by its own rules.
- Model backends—local or self-hosted over pay-per-token APIs and over capped free tiers (request caps throttle an agent loop); never spoof Claude Code's identity headers to reuse a subscription token elsewhere. System One judgments use only models listed at systemonemodels.org, never OpenJev; `dowse` (grove/stele/sandman) defaults to hosted TypeSafe, falls back to local Kev when out of tokens or down, and errors when both are down. (since 2026-09-25) (since 2026-07-19; allowlist 2026-09-25)
- Never mutate to inspect—a diagnostic is read-only (`git stash`/`reset`/`clean`/`checkout --`/`restore`, destructive flags). Undo your own botched edit by re-editing, never by tree-discard: `git checkout -- <path>` throws away _every_ uncommitted change to the path, co-resident work included. (since 2026-08-31 · bridge scene: a subagent's checkout-- undo wiped another feature's uncommitted elements)
- Skills self-describe via frontmatter—never restate a skill's behavior elsewhere.
- Stale docs are bugs—correct or explicitly flag an artifact contradicting the live system in the turn you notice it.
- Stamps cite portable provenance—a repo-relative file or the primary source (arXiv/URL), never a machine-local path.
- Taste is previewed, never committed—on an open-ended aesthetic ask put a concrete sample in front of him and get a word before an execution pass; commit-and-build is for technical calls. (since 2026-07-31 · a chosen theme plus a four-agent reskin stopped mid-flight: "i'm not liking this at all")
- The harness repo is `jgeschwendt/claude`, public, at `~/.grove/code/jgeschwendt/claude/main`—config, skills, rules and docs only; personal material lives in `~`, the private profile repo. `~/.claude` is not a repo: runtime state plus symlinks into the trunk; `mise run link` re-links, and `drift:` means a writer replaced a link with a real file—merge by hand, never overwrite. (verified 2026-09-09 · gh repo view; moved under grove 2026-09-28)
- Threads—out-of-session messaging is `~/.threads`, reached through the `threads` MCP tools inside a session or the `thread` CLI: a `needs input:`/`failed:` line in a turn's last message opens one (Stop hook) and threads waiting on you arrive as context at session start and every prompt; a decision that needs options or context is `thread open … --kind decision --option …` under the same key; when `thread wait` returns, answer set → act then `thread resolve`, otherwise reply (a table for a comparison, revise options as asked) and wait again. An answer the operator gives in-session goes on the thread too — `thread reply <id> --as user --answer <text>` — and a `needs input:` thread answered by the next prompt is closed by the UserPromptSubmit hook, never left waiting: an answered thread nobody writes to nags forever. (since 2026-09-09 · visor t65: two threads sat “waiting: user” after the operator answered in the pty)
- Throwaway credentials for new services—propose a generated value or take his through a `!`-prefixed command; never a real account password, which Basic Auth would replay into process lists, transcripts and history. (since 2026-07-19)
- Use Unicode symbols (typographic), never emojis (decorative).
- Verify empirically—live source or docs for library/API details, the probe or failing case for behavior claims; neither confident recall nor plausible inference counts.

## Thinking

- **Chiastic structure.** For complex features the journey inward is discovery, the journey outward redesign: scaffold to the core, complete it, then rebuild each outer layer against what the center required—never finalize an outer layer before the inner ones have spoken.
- **Compromise.** Where each option is load-bearing and internally whole the payoff is bimodal—it peaks at A and at B and craters in the blend, which inherits both costs and the coherence of neither, often landing below either pure choice. Commit to A or B, never average into a C. Where they differ merely in degree, tune freely.
- **Premise inheritance.** A conclusion is only as sound as premises the request hands down unstated ("add a cache to fix the latency" presumes the latency is cacheable). Surface the load-bearing ones and pressure-test them before work rests on them—the root is the cheapest place to be wrong; inherit the rest freely.

## Tools

Name the target on every repo-relative tool—`git -C <repo>`, `mise x -C <repo>`, `cd <repo> && stele …`—never ambient cwd, which resets under you and rarely errors when wrong: nested checkouts make it a real repo that accepts the write. `mise x -C <dir>` also chdirs into `<dir>`, so it runs only commands meant for that tree—a scratch experiment run through it lands its writes in the repo. (since 2026-09-08 · research agent overwrote typescript/package.json + bun.lock via `mise x -C <repo> -- bun add`)

- `agent-browser` for autonomous web tasks except when project tooling conflicts; co-browsing ("open this so we can work together") means the user's real Chrome via claude-in-chrome, never an automation window—if the extension won't connect, `osascript 'open location'` gets the page in front of them while it's sorted. (since 2026-08-19 · headed agent-browser session rejected as "a test one")
- `ripgrep` over `grep`.
