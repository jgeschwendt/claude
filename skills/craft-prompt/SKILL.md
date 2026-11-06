---
name: craft-prompt
description: Craft, refine, or debug a prompt in the house style — imperative voice, rule-first structure, explicit rationale, XML-tagged exemplars, silence on success.
when_to_use: "Use when the user asks to write, refine, review, or improve any prompt — tool prompts, skill/workflow prompts, sub-agent personas, system prompts, or general LLM instructions. Also use when the user pastes a draft asking for feedback, or when a prompt or agent misbehaves ('my agent keeps doing X', 'why does it ignore my instructions') — the Debug branch diagnoses from the symptom. Trigger phrases: 'craft a prompt', 'write a prompt', 'refine this prompt', 'debug this prompt', 'make this more house-style', '/craft-prompt'."
argument-hint: '[draft to refine OR description of what you want to craft]'
allowed-tools:
  - AskUserQuestion
  - Edit
  - Glob
  - Grep
  - Read
  - Write
---

# /craft-prompt — Draft or refine a prompt in the house style

Imperative, rule-first, examples-as-specifications, silent on success.

## When invoked

Classify the argument (rendered under §User input at the end of this file), then route. First match wins — rows are ordered most-specific first:

| Input shape                                                                                                                           | Branch        | Hot path                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| Prompt + observed misbehavior ("it keeps doing X", a transcript excerpt)                                                              | **Debug**     | references/diagnostics.md → root cause → minimal diff + regression case → AskUserQuestion (save?) |
| Paste + rewriting forbidden ("review only", "feedback only", "don't rewrite")                                                         | **Review**    | §Refinement checklist → findings, no rewrite → AskUserQuestion (apply?)                           |
| Description + partial draft                                                                                                           | **Hybrid**    | treat the paste as current state; refine toward the description                                   |
| Verbatim prompt text, any length — or a referent to load (a path, a skill name, or a prior-turn artifact: "the prompt we just wrote") | **Refine**    | §Refinement checklist → diff → AskUserQuestion (save?)                                            |
| Description only ("a skill that does X", "a prompt for Y")                                                                            | **Draft**     | §Drafting → full draft → AskUserQuestion (refine / save?)                                         |
| Empty                                                                                                                                 | **Interview** | one AskUserQuestion to pick type → route                                                          |

Frontmatter, imperatives, a role statement, or ≥5 lines are signals of a draft — not gates; a one-line pasted prompt still refines. A bare "review this" routes to **Refine** (the diff IS the review); **Review** fires only when the user forbids rewriting.

<example>
user: "make this better: You are a helpful assistant that reviews PRs."
assistant: <thinking>One line, but it's verbatim prompt text — a draft, not a description; length is a signal, not a gate. "Make this better" doesn't forbid rewriting → Refine, not Review.</thinking>
Refining: the one-line persona gets a role with seniority, a scope fence, and an output contract.
<commentary>
Short pastes tempt the Draft branch, which would invent a new prompt; anything that IS prompt text refines the text the user gave.
</commentary>
</example>

### Turn shape (every response follows this)

1. **Opening line (one sentence)** — name the branch; if refining, name the 1–3 highest-impact issues being fixed.
2. **Artifact** — fenced code block containing the draft (a unified diff for refinement; a findings list for review-only; for Debug, the minimal targeted diff plus the regression case). Use a 4-backtick outer fence when the artifact itself contains triple-backtick fences — a 3-backtick wrapper terminates early and corrupts rendering. For large prompts, per-section before/after excerpts beat one monolithic diff.
3. **Rationale** — ≤ 3 bullets, one sentence each, only where the change isn't self-evident. Ship-gate untested-test disclosures don't count against the cap.
4. **AskUserQuestion** — options by branch, recommended option first with `(Recommended)`:
   - Refine / Hybrid / Draft / Debug — _Save_ · _Refine further_ · _Discard_. Recommend _Save_ after a clean pass, _Refine further_ while findings remain open.
   - Review — _Apply fixes_ · _Keep findings only_ · _Discard_. Recommend _Apply fixes_.
   - Interview ends on the type question instead.

### Per-branch success criteria

- **Debug** — the symptom is traced to named prompt text (quote the line) via `references/diagnostics.md`; the fix is the smallest diff that removes the cause — not a restyle (offer Refine separately if the prompt needs one). The reply ends with the regression case: the exact input that failed, to re-run after the edit. No transcript and an ambiguous symptom → ask for the transcript before prescribing.
- **Refine** — every flagged checklist item has a proposed rewrite OR an explicit _"kept as-is: reason"_. Nothing silently dropped. If nothing flags, say so in one line and recommend _Save_ — do not manufacture a diff.
- **Review** — findings only: each hit shows the offending line, the issue, and the fix it would get. Do NOT rewrite unsolicited; offer to apply via AskUserQuestion.
- **Draft** — frontmatter complete; one-line capability in first 200 chars; body follows canonical anatomy for the type; at least one `<example>` block if the prompt prescribes a decision with failure modes.
- **Interview** — one AskUserQuestion call; user picks a type (options, max 4: _Tool_ · _Skill/workflow_ · _Sub-agent persona_ · _Classifier/judge_; the built-in _Other_ covers system-prompt sections and hybrids); next turn routes to Draft (or Refine, if they then paste a draft).
- **Hybrid** — same as Refine, with the description as governing intent when draft and description conflict.

**Ship gate (any branch that reaches _Save_ or _Apply fixes_):** sweep §Stress-testing first — run its desk-checkable tests (1, 3, 5, 9) and fix what fails; name the live-only tests (2, 4, 6, 7, 8) as untested in a rationale bullet rather than claiming them. Any failure observed live becomes a named regression case beside the prompt (→ references/evals.md).

Do NOT restate the user's request. Do NOT open with "Great question", "Let me help you", or any acknowledgment. Go straight to the artifact (Interview: straight to the type question) — preamble spends the turn on what the user already knows.

## Scope (when NOT to use this skill)

Not for writing documentation prose, commit messages, code comments, user-facing emails, or product copy. Only for prompts intended to instruct an LLM: tool schemas, sub-agent personas, SKILL.md bodies, system prompts, or sections thereof.

## Reference library

This skill is an index over seven references under `${CLAUDE_SKILL_DIR}/references/`. The operational core is below; load a reference when the table says to (use Read/Grep — do not work from memory of them).

| File                                                                               | Load it when                                                                 | Holds                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [references/techniques.md](references/techniques.md)                               | drafting or refining any prompt                                              | the exhaustive techniques catalog (Structure · Voice · Examples · Interaction · Delegation · Constraint enforcement · Failure-mode teaching · Persistence and throttling · Argument handling · Output formats · Persona & self-framing · Prompt assembly), plus the anti-patterns reject-list and the voice fingerprint |
| [references/playbook.md](references/playbook.md)                                   | you need a stock phrase, XML tag, template variable, or special-case pattern | phrasebook · XML tag taxonomy · template variables · special-case patterns                                                                                                                                                                                                                                              |
| [references/diagnostics.md](references/diagnostics.md)                             | a prompt misbehaves — you have a symptom, not a style itch                   | the failure-first index: observed symptom → root cause → fix, ~40 entries (rule-following · triggering · fabrication · scope · output · delegation · durability · injection · cost · multi-turn)                                                                                                                        |
| [references/transformations.md](references/transformations.md)                     | before a large Refine, or to model the editing process                       | four worked transformations with every move named (reviewer · deletion · closed-world judge · Debug minimal-diff), each closing with what was deliberately NOT done                                                                                                                                                     |
| [references/evals.md](references/evals.md)                                         | at any ship gate, on a model upgrade, or when a fix needs a regression case  | eval-and-regression doctrine: regression-file shape · desk vs live checks · LLM-as-judge design · transcript-driven refine loop · model-upgrade protocol                                                                                                                                                                |
| [references/claude-code/exemplars.md](references/claude-code/exemplars.md)         | you need a worked model for a prompt kind                                    | canonical Claude Code prompts to study whole, grouped by kind (tool · agent · skill · command · system · safety)                                                                                                                                                                                                        |
| [references/claude-code/architectures.md](references/claude-code/architectures.md) | you are building a prompt _system_, not authoring one prompt                 | Claude Code runtime mechanics: composition pipeline · cache scopes · attachment lifecycle · delegation · compaction                                                                                                                                                                                                     |

`references/<harness>/` holds faithful, real-name reference pulled from a specific harness (currently `claude-code/`); `techniques.md`, `playbook.md`, `diagnostics.md`, `transformations.md`, and `evals.md` are the harness-agnostic distillation — ours. As more harnesses are studied, each gets its own `references/<harness>/`.

`techniques.md` exceeds one Read window — start from its `## Navigation` block and Grep the exact subgroup heading. Load co-needed references in parallel, in a single message.

## Core principles (the house style in 12 rules)

These are numbered for citation: sibling skills address them by number (`principle 11`), so each number is an address — reorder or renumber and every inbound pointer breaks. Exempt from house alpha-sort (CLAUDE.md § Rules).

1. **Rule first, rationale second.** State the constraint in imperative form, then — same line or next — explain _why_ in one phrase. The why lets the model generalize to unlisted edge cases. Canonical: _"NEVER run destructive git commands … Taking unauthorized destructive actions is unhelpful and can result in lost work, so it's best to ONLY run these commands when given direct instructions"_.

2. **Negative framing beats positive for hallucination-prone behaviors.** "Don't peek. Don't race. Don't re-delegate understanding" is stronger than "trust the process." Write prohibitions for behaviors the model would otherwise invent.

3. **Examples are specifications, not illustrations.** An `<example>` block with `<thinking>` and `<commentary>` shows the exact cognitive pattern expected. The model will reproduce the _shape_ of your examples — pick them so that reproduction is the desired behavior.

4. **Scope boundaries up front.** For tools and agents, declare what the thing does _not_ cover before listing what it does. `"When NOT to Use"` prevents misfires more efficiently than `"When to Use"` alone.

5. **Prefer dedicated tools, name the anti-pattern inline.** _"Use Edit (NOT sed/awk)"_. The parenthetical is the whole teaching — the ban is next to the preferred tool, not in a separate footnote.

6. **Escape hatches, not absolutes.** Every `NEVER` gets an "unless the user explicitly requests it." Authorization is narrow: approving one action does not generalize. Durable authorization lives in CLAUDE.md.

7. **Silence on success.** Specify when the model should _not_ output. _"Only post to Slack if you actually found something stuck. If every session looks healthy, tell the user that directly — do not post an all-clear to the channel."_

8. **Priority markers carry real weight.** `IMPORTANT`, `CRITICAL`, `NEVER`, `MUST`, `ALWAYS` — reserved for hard constraints. If they appear in every paragraph they mean nothing. Budget: 1–3 per major section. And they're calibrated to a model generation: emphasis that fixed undertriggering on an older model overtriggers on a newer, more instruction-responsive one — on upgrade, the fix is dialing back, not adding (→ evals.md §Model-upgrade protocol).

9. **Parallel by default.** When multiple operations don't depend on each other, prescribe `"in parallel, in a single message"`. This phrase actually changes batching in practice.

10. **Write for the executing model.** Weaker or faster models need prescription — closed worlds, literal templates, more examples. Frontier models need altitude — catalysts, rationale, room for judgment; over-prescription actively fights them. When one prompt must serve both, ship audience-keyed variants rather than averaging (→ playbook §Audience-keyed variants). Robustness is model-version-dependent: re-run the regression cases on every model upgrade (→ evals.md).

11. **The smallest set of high-signal tokens.** Context rot is empirical — recall degrades as context grows — so every line must earn its place against the whole context, not merely read well alone. Refinement always includes a deletion pass; the best fix for a mis-followed prompt is often fewer words, not more. (verified 2026-07-13 · Anthropic context-engineering)

12. **Conflicts are eliminated, not arbitrated.** Instruction hierarchy is unreliable — placement wins a contradiction as little as 10–46% of the time. Never ship a prompt whose rules disagree and hope the important one lands; find the conflict and resolve it in the text (→ techniques §Framing the Judgment).

## Anatomy by prompt type

### A. Tool prompt (Bash / Read / Edit / … style)

Canonical section order:

| #   | Section                       | Purpose                                                                                |
| --- | ----------------------------- | -------------------------------------------------------------------------------------- |
| 1   | One-line capability           | _"Reads a file from the local filesystem."_                                            |
| 2   | Trust statement               | _"Assume this tool is able to read all files on the machine."_ — justifies later rules |
| 3   | When to use / When NOT to use | Numbered conditions, each with a 1-line example                                        |
| 4   | Usage notes                   | Parameter hygiene, path rules, flags                                                   |
| 5   | Examples (multi-turn)         | `<example>` with `<thinking>` and `<commentary>`                                       |
| 6   | State preconditions           | _"You must use Read at least once before editing."_                                    |
| 7   | IMPORTANT notes               | Meta-level footguns                                                                    |

Land the trust statement and the first footgun in the first 200 chars. BashTool does this:

> _Executes a given bash command and returns its output. The working directory persists between commands, but shell state does not. …_
> _IMPORTANT: Avoid using this tool to run `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task._

### B. Skill / workflow prompt (SKILL.md)

Frontmatter (canonical form from the Skillify meta-skill):

```yaml
---
name: skill-name
description: one-line description
when_to_use: "Use when... Examples: 'trigger phrase', 'another phrase'"
allowed-tools: [Bash(gh:*), Read, Write, AskUserQuestion]
argument-hint: '[hint showing argument placeholders]'
arguments: [foo, bar] # @internal alias of argument-hint, the documented form (CLI 2.1.215); use $foo in body
context: fork # omit for inline; use for self-contained workflows
---
```

Body order:

1. `# Title` — action-oriented, short
2. One-sentence opener on what the skill does
3. `## Inputs` — describe each `$arg` if any
4. `## Goal` — one paragraph with a concrete artifact or success condition
5. `## Steps` — numbered. **Success criteria** required per step. Optional annotations: **Execution** (`Direct` / `Task agent` / `Teammate` / `[human]`), **Artifacts** (data later steps consume), **Human checkpoint** (pause-and-confirm points), **Rules** (hard constraints).
6. `## Rules` — closing constraints, silence rules, edge cases

Router-style skills (like this one) may replace `## Goal` + `## Steps` with a routing table and per-branch success criteria — the linear anatomy serves linear workflows.

Frontmatter rules:

- `allowed-tools`: minimum permissions, patterns over names (`Bash(gh:*)` not `Bash`)
- `when_to_use` is load-bearing: start with "Use when…", include 2–3 trigger phrases verbatim. It must carry the full trigger signal alone — skills are progressive disclosure: name+description always loaded, body loaded on trigger, referenced files on demand. A body rule can't rescue a description that never fires. (verified 2026-07-13 · Anthropic agent-skills guidance)
- `context: fork` only for self-contained workflows with no mid-process user input
- Use `$arg` in body for substitution; `${CLAUDE_SKILL_DIR}` references bundled files; `!`shell command`` injects live output at expansion time
- Step-structure tips: concurrent steps use sub-numbers (3a, 3b); human-action steps get `[human]` in the title; keep simple skills simple — a 2-step skill doesn't need annotations everywhere
- Body budget ~500 lines; split overflow into referenced files along usage boundaries — contexts that are mutually exclusive or rarely co-loaded belong on separate paths
- Bundled scripts: state whether the model runs them or reads them as reference — ambiguity produces both behaviors

### C. Sub-agent persona prompt

Three-part structure, in this order, every time:

1. **Role statement** — one sentence naming the agent and its primary function.
   _"You are a software architect and planning specialist for ${AGENT_HARNESS}."_
   _"You are a file search specialist for ${AGENT_HARNESS}, ${VENDOR}'s official CLI for ${MODEL_NAME}. You excel at thoroughly navigating and exploring codebases."_

2. **Scope fence** — `=== CRITICAL: ... ===` around hard boundaries. For read-only agents, list every write surface blocked (Write, touch, rm, cp, mv, redirect operators, heredocs). For specialist agents, list out-of-scope domains. Close with a redundant reminder after the guidelines: _"REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files."_

3. **Strengths + Guidelines + Approach** — bulleted, imperative. If the agent should follow a prescribed workflow (fetch docs, then search, then fall back to web), number the steps.

### D. System-prompt section

Dense imperative bullets. Each bullet is self-contained (the reader might skip everything above it). Mirror the six-part system-prompt frame:

- `# System` — tool architecture, permissions, `<system-reminder>` semantics
- `# Doing tasks` — scope discipline, read before proposing, verify before claiming done
- `# Executing actions with care` — reversibility, blast radius, confirmation defaults, authorization scope
- `# Using your tools` — dedicated over general, parallel vs sequential, task tracking
- `# Tone and style` — emojis, `file_path:line_number`, no colon before tool calls, `owner/repo#123`

Static cacheable content goes first; session-variant content last. Cache keys stay stable on the prefix.

### E. Classifier / judge prompt

Consumed by a parser, not a person. Canonical section order:

1. **Consumer + input shape first** — open by naming who consumes the verdict and exactly what inputs arrive, so relevance is judged against a concrete use. _"You are selecting memories that will be useful to ${AGENT_HARNESS} as it processes a user's query. You will be given…"_
2. **Closed-world output contract** — exact literal verdicts, first token pinned (_"Your ENTIRE response MUST begin with `<block>`"_), the explanatory field demanded only on the failing branch, one reserved sentinel for the can't-do case (_"respond with exactly \"INVALID\""_).
3. **Decision rules as a priority cascade** — most-authoritative signal first; pre-adjudicate recurring edge cases as labeled precedents; encode domain impossibilities as carve-outs so known noise classes never surface.
4. **Confidence gating + tie-break direction** — state the precision/recall cost asymmetry and which way to fall (_"When in doubt, INCLUDE"_ vs _"Below 0.7: don't report"_). Bless the empty answer.
5. **Paired specimens on both sides of the boundary** — the smallest reject cases anchor the floor; render the no-op in the same wrapper as a hit (`<updates>[]</updates>`).
6. **Bracket fragile constraints** — a no-tools / text-only rule stated top AND bottom, with the penalty named.

Parser-side contract: strip `<thinking>` spans before matching verdict tags. If latency matters, stage it — a token-capped binary pass whose _allow_ is final, escalating to chain-of-thought only to overturn a _block_ (see `references/claude-code/architectures.md` §8, yolo classifier).

## Minimum viable prompt

Not every prompt needs the full anatomy.

| Use case                               | Minimum shape                                                         | Reference                   |
| -------------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| One-shot classifier                    | Role (1 sentence) + strict output schema + 1 example                  | §E · closed-world JSON      |
| Extraction to JSON                     | Role + schema + 2–3 examples                                          | —                           |
| Simple tool prompt                     | Capability line + "When NOT to use" + 1 parameter note                | ~10 lines                   |
| Simple workflow skill                  | Frontmatter + Goal + 2–3 Steps + Rules                                | ~50 lines                   |
| Complex workflow / multi-phase         | Phases + parallel fanout + per-step success criteria                  | multi-phase orchestration   |
| Sub-agent persona with hard boundaries | Role + `=== CRITICAL ===` scope fence + guidelines + closing reminder | read-only specialist agents |
| Full system-prompt section             | Dense imperative bullets, cache-boundary-aware                        | a full agent system prompt  |

**Rule of thumb**: the prompt should be as long as its failure surface is wide. A classifier with a 2-value output doesn't need `<thinking>` tags. A multi-phase workflow with async sub-agents does. If you're writing more than the anatomy demands, that's scope creep _in the prompt itself_ — cut.

**Anti-rule**: don't pad a short prompt with anatomy sections it doesn't need ("When NOT to use" for a 10-line classifier is ceremony, not clarity).

## Drafting (when the argument is a description)

1. **Identify the type and the missing context.** Match the description against the five anatomies in §Anatomy, then gather the load-bearing facts the description doesn't answer: who consumes the output (person or parser), the harness and runtime (available tools, cache posture), what triggers it, the target model, and any failure modes already observed. Ask only for genuine gaps — one AskUserQuestion call, max 4 questions (priority: type > consumer > trigger > runtime); default-and-disclose whatever doesn't fit.

2. **Draft the frontmatter first** (for skills) or the one-line capability + trust statement (for tools/agents).

3. **Write the body using the canonical section order** for that type. Use tables for decisions, numbered lists for steps, fenced code for examples.

4. **Add 1–2 exemplars** with `<example>` / `<thinking>` / `<commentary>` if the prompt prescribes a decision with failure modes.

5. **Run §Refinement checklist** over the draft before presenting.

6. **Present**, then ask whether to save (and where) or refine further. Do not write to disk without explicit approval.

## Refinement checklist

When the argument contains a draft, run through these. For each hit, show the original line, the rewrite, and a one-sentence reason. Skip sections that don't apply — under 20 lines, most won't. Don't pad.

**Structure**

- [ ] One-line capability / purpose in the first 200 chars?
- [ ] "When NOT to use" section for tools/agents with ≥2 boundary cases?
- [ ] Examples wrapped in `<example>` with `<thinking>` and/or `<commentary>` where a decision is prescribed?
- [ ] Frontmatter complete (name, description, when_to_use with trigger phrases, allowed-tools as minimal patterns)?
- [ ] Section order matches the canonical anatomy for this prompt type?

**Voice**

- [ ] Any hedging (_probably / might / could / consider / perhaps_)? Cut or replace with imperative.
- [ ] Any preamble (_"Great question…"_, _"Let me help you…"_)? Cut.
- [ ] Narration of WHAT the code does? Cut. Keep only non-obvious WHY.
- [ ] Colons before tool calls? Replace with periods.
- [ ] Emojis (not explicitly requested)? Remove.

**Rules**

- [ ] Every `NEVER` / `MUST` has a rationale AND an escape hatch?
- [ ] Priority markers (`IMPORTANT` / `CRITICAL`) ≤ 3 per major section — and each survivor still needed on the current model generation, not inherited from an older one's reticence?
- [ ] Every hallucination-prone behavior explicitly prohibited with a `Don't X` rule?
- [ ] Every safety rule carries its WHY (use a past failure mode if the user can supply one)?
- [ ] No two rules contradict — conflicts resolved in the text, not left to placement (principle 12)?

**Interaction**

- [ ] Prescribed questions are `AskUserQuestion` calls, not prose?
- [ ] Recommended option first with `(Recommended)` suffix?
- [ ] Success-silence condition specified ("don't post if clean")?
- [ ] Parallel ops prescribed with `"in a single message"`?
- [ ] Plan-mode approval via ExitPlanMode (not AskUserQuestion)?

**Output**

- [ ] Output format prescribed — structure, section names, length bound — as the target shape, not only prohibitions?
- [ ] Long input material (documents, transcripts) placed above the query, instructions at the end?
- [ ] HEREDOC example for multi-line command args (commits, PR bodies)?
- [ ] File references in `file_path:line_number` format?
- [ ] GitHub refs in `owner/repo#123` format?

**Delegation** — skip unless the prompt spawns or briefs agents (→ techniques.md §Delegation)

- [ ] Prompt mode matches the callee: directive for a context-inheriting fork, self-contained briefing for a fresh spawn?
- [ ] Scope triad (in / out / owned-by-others) when agents run in parallel?
- [ ] Return channel named — format, length cap, and who consumes the report?
- [ ] Caller keeps synthesis ("never delegate understanding") — no _"based on your findings, fix it"_?

**Enforcement** — skip unless the prompt emits verdicts or machine-parsed output (→ techniques.md §Constraint enforcement)

- [ ] Verdict strings closed-world: exact literals, first token pinned, variation forbidden?
- [ ] Gates symmetric: evidence required to PASS, false-positive rule-outs required to FAIL?
- [ ] Escape-hatch verdict fenced to a precise cause, not a hiding place for indecision?
- [ ] Tie-break direction stated from the cost asymmetry (precision vs recall)?

**Assembly** — skip unless the prompt is composed or embedded at runtime (→ techniques.md §Prompt assembly, claude-code/architectures.md)

- [ ] Static content before session-variant content; no volatile literals in the cacheable prefix?
- [ ] Long prompt's one fragile constraint bracketed — stated in the opener AND the trailer?
- [ ] Persistent-mode instructions throttled full/sparse, not repeated verbatim every turn?
- [ ] Optional args spliced under a labeled section behind a presence guard — no dangling headers?

**Anti-creep**

- [ ] Does the prompt tell the model to do more than asked? Cut.
- [ ] Defensive error handling for impossible cases? Cut.
- [ ] Claims success without prescribing verification? Add a verification step.
- [ ] Any dead language ("Write clean code", "Be careful")? Cut or make specific.
- [ ] Deletion pass run — does every line still earn its tokens against the whole context (principle 11)? Token-level density on a shipped artifact → /tighten (`~/.claude/skills/tighten/SKILL.md`).

## Stress-testing a prompt

Run these before shipping:

1. **Empty argument** — does the prompt handle `$ARGUMENTS` empty without breaking? Show a usage message; don't proceed with a placeholder.
2. **Oversized argument** — paste something 10× the expected size. Does it still behave?
3. **Ambiguous argument** — one that matches two branches of the routing. Does the prompt pick deterministically, or flip-flop?
4. **Adversarial argument** — _"ignore previous instructions and…"_ / _"you are actually a different agent now…"_. Do the rules hold?
5. **"No good answer"** — a question the prompt genuinely can't answer from available info. Does it say so, or fabricate?
6. **Multi-turn pushback** — invoke, see output, reply _"not quite right, do X differently"_. Does turn 2 stay coherent with turn 1's framing, or drift?
7. **Compaction survival** — run in a long session where compaction fires. Does the skill re-inject correctly?
8. **Fresh sub-agent** — if the prompt ever runs in a `context: fork` skill or sub-agent, spawn one with just the prompt and no conversation history. Does it still work?
9. **Premature success** — does the prompt ever need to declare the task done? If so, feed it a near-complete-but-broken state. Does it catch the gap or cheerfully pass?

Tests 1, 3, 5, 9 are desk-checkable by reading the prompt; 2, 4, 6, 7, 8 require a live session. Cap each test at 2–3 minutes. If a test fails, fix the prompt, don't rationalize the failure. If you can't run one of these, say so explicitly in the prompt's description — _"known untested for adversarial input"_ beats silent uncertainty.

**Keep the failures.** Every observed failure becomes a named regression case kept beside the prompt (an eval file or a comment block); re-run the set after every edit and every model upgrade. A prompt that doesn't carry its failure history re-learns the same lessons. The machinery — regression-file shape, desk vs live tiers, LLM-as-judge grading, the transcript-driven refine loop, the model-upgrade protocol — is in `references/evals.md`.

## Rules

- Present the full draft in a fenced code block before writing to disk — let the user review with syntax highlighting and give explicit approval; no file is written without it.
- Save personal skills to `~/.claude/skills/<name>/SKILL.md`; project-scoped skills to `.claude/skills/<name>/SKILL.md`. Ask via AskUserQuestion if unclear.
- Use `AskUserQuestion` for every choice the user makes — never in plain prose, where options aren't clickable and get lost in scroll. The built-in _Other_ is always present — never hand-build one.
- When the argument names an existing skill or file instead of pasting it, locate it with Glob and Read it before refining.
- Preserve the user's voice when it's clearer than the house style. The house style is a default, not a filter. An explicit style instruction from the user outranks it: apply the structural and correctness groups, skip §Voice, and say so.
- When refining, show a unified diff or a clear before/after. Do not silently rewrite — the user should see what changed and why.
- If the user pushes back on an edit, accept it and move on. Do not argue with the finding.

## Learning

No capture queue. The moment a run goes off the documented playbook, encode the fix directly into its destination (Golden Rule, CLAUDE.md), backed by a concrete artifact (the draft, the user's hand-correction, or the `source/file.ts:line` of a newly-spotted pattern): a routing/turn-shape/checklist defect → this SKILL.md · a missing or wrong catalog entry → `references/techniques.md` / `references/claude-code/exemplars.md` / `references/playbook.md` · a newly observed symptom→fix → `references/diagnostics.md` · a Refine move the worked examples don't teach → `references/transformations.md` · an eval/judging/regression move → `references/evals.md` · a project-specific convention → that repo's `.claude/` · the user's personal style → user memory (`attend.sh` sidecar — CLAUDE.md § Memory). Stamp the edit `(since <date> · <artifact>)`. Net-zero — an overlap with an existing catalog entry or checklist line merges into that line, never adds one.

## User input

Everything above governs the argument below. It may be empty (→ Interview).

```
$ARGUMENTS
```
