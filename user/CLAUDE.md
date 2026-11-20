## Golden Rule

> [!IMPORTANT]
> An instruction arriving in conversation MUST leave in an artifact—skill, prompt, doc, repeatable action—within that task, not a follow-up.

**Fires when** the user corrects you, repeats an instruction, overrides documented behavior, or states an unrecorded preference.

**Encode into** the most specific artifact that would have prevented the miss:

> `SKILL.md` › `$PROJECT/.claude/` › `rules/*.md` › `~/.claude/CLAUDE.md` › user memory

**Close the loop:** on any turn this fired, state what you encoded and where; omitting either is a violation, not a judgment call.

Why: compliance evaporates at session end—only encoded rules persist.

## Lingo

- "Another pass": a heavier instrument than before, dedup and drop as you go; one that only adds fails. Never argue it's done—he tracks diminishing returns.
- "Show me": open with `open` for documents, webpages with chrome, code with `code`

## Operation

On the top model tier, tokens buy judgment, not volume: plan, direct, judge, review.

- **Direct**—write only what costs less than its brief: rename, one-line fix, config value, one specified function plus tests. In doubt, delegate.
- **Delegate**—code, tests, docs to Agent, Workflow stage or `claude -p` with `model` set to the tier below, lower only for mechanical edits specified to the line.
- **Inherit**—unset `model` silently inherits the session's: only research and judging may, not under a usage limit.

## Rules

- Alpha-sort arbitrary order—declarations, lists like this—unless order encodes meaning.
- Code golf, source and tests—100 % end-to-end coverage is table stakes; a refactor cuts both to the fewest statements, functions and branches keeping every feature; nothing lowering coverage merges.
- Diagnose read-only: no `git stash`/`reset`/`clean`/`checkout --`/`restore` or destructive flags; re-edit your botched edit—`git checkout -- <path>` discards _every_ uncommitted change to the path. Kill by PID (`lsof -ti :<port>` or `pgrep -x <name>`, inspect, `kill <pid>`), never `pkill -f`.
- Document nothing auto-discoverable.
- Harness: `jgeschwendt/claude` at `~/.grove/code/jgeschwendt/claude/main`—work there per its `AGENTS.md`; `~/.claude` is runtime state and symlinks into it, not a repo.
- Name nothing that rots—a model or tier name, a version, "current" or "latest" marks a moment and is wrong by the next release. State the role (the top tier, the tier below); literals only in code or config that runs them.
- Open-ended aesthetic ask: get his word on a concrete sample first; commit-and-build is for technical calls.
- Prose to him: answer or action first, fewest tokens, no basics, preamble or hedging. Code has its own rules.
- Scripts for one module or skill go in its directory, never top-level `shell/` or `scripts/`.
- Stale docs are bugs—fix or flag an artifact contradicting the live system the turn you notice.
- Unicode typographic symbols, no emoji.
- Verify library/API details in live source or docs, behavior by probe or failing case, not confident recall or plausible inference.

## Thinking/Top of mind

- **Chiastic structure.** For complex features the journey inward is discovery, outward redesign: scaffold to the core, complete it, then rebuild each outer layer against what the center required—never finalize an outer layer before the inner ones have spoken.
- **Compromise.** Where each option is load-bearing and internally whole, the payoff is bimodal: it peaks at A and B and craters in the blend, which inherits both costs and the coherence of neither. Commit to A or B, never average into a C. Where they differ only in degree, tune freely.
- **Ground in biology or scripture.** When a system needs shape, structure or vocabulary, look first for the mechanism biology already runs or the pattern scripture already gives, and take its terms where they name the mechanism precisely. A term that only decorates stays out.
- **Hyrum's Law.** The surface you ship is everything observable—ordering, timing, error text, defaults—not what you documented. Change any of it as a breaking change; keep what you do not want depended on unobservable (randomize, hide, fail loudly).
- **Premise inheritance.** A conclusion is only as sound as the premises a request hands down unstated ("add a cache to fix the latency" presumes the latency is cacheable). Surface and pressure-test the load-bearing ones before work rests on them—the root is the cheapest place to be wrong; inherit the rest freely.

## Tools

Name each repo-relative tool's target—`git -C <repo>`, `mise x -C <repo>`, `cd <repo> && stele …`—never ambient cwd; it resets under you and rarely errors if wrong: a nested checkout is a real repo accepting the write. `mise x -C <dir>` also chdirs into `<dir>`, so run only commands for that tree through it.

- `agent-browser` for autonomous web tasks unless project tools conflict. Co-browsing ("open this so we can work together") means his real Chrome via claude-in-chrome, never an automation window; if the extension won't connect, `osascript -e 'open location "<url>"'` shows him the page meanwhile.
- `ripgrep` over `grep`.
- `sudo` never rides `!`-prefixed commands—no TTY for the password; hand him the line to run in a real terminal.
