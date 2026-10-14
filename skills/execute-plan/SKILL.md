---
name: execute-plan
description: Execute an approved plan via ultracode orchestration — the session model decomposes, orchestrates, and reviews; pinned opus agents do every line of implementation. Defaults to the newest plan in ~/.claude/plans/.
when_to_use: >
  Use when a plan exists (approved in plan mode this session, or a file in
  ~/.claude/plans/) and the user wants it carried out. Trigger phrases:
  "/execute-plan", "execute the plan", "run the plan", "carry out the plan",
  "ultracode the plan", "build it". Execution happens in-session, with the
  model split pushed into the workflow agents.
argument-hint: "[plan file — defaults to newest in ~/.claude/plans/]"
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

# Execute Plan

$ARGUMENTS

Carry out an approved plan with the cost split enforced: the session model
plans, orchestrates, judges, and reviews — it NEVER types implementation code.
Pin every implementing agent to `model: 'opus'` (or cheaper). Runs inline —
the reviewer needs the planner's context.

## Hard rule: the model split

Workflow and Agent spawns inherit the session model by default — in a premium
session an unpinned `agent()` call burns premium tokens on mechanical work.
Therefore `model:` is mandatory on EVERY `agent()` call this skill makes; no
stage relies on inheritance. `effort: 'low'` additionally on mechanical stages
(renames, mass edits, boilerplate) — the measured shape is a sandwich: deep
at decompose and review, lower through the mechanical middle; uniform maximum
loses under wall-clock limits (2026-07-14 · LangChain harness-engineering,
Terminal-Bench 2.0).

## Steps

### 1. Resolve the plan

- Explicit path from `$ARGUMENTS` › the plan approved in this session ›
  newest file: `ls -t ~/.claude/plans/*.md | head -1`.
- Resolve a relative `$ARGUMENTS` against the cwd to an absolute path before
  reading. If all three sources miss (no arg, no session plan, empty
  `~/.claude/plans/`), stop and ask — never proceed with an empty plan path.
- Read the plan fully. Confirm the target repo/cwd matches the plan's assumptions,
  and spot-check plan-vs-reality drift (files moved, APIs changed since the
  plan was written) before spawning anything.

**Success criteria**: Plan loaded, target repo confirmed, drift noted (or
none). If the plan names a different repo than the cwd, stop and say so.

### 2. Decompose into a workflow

- Split the plan into self-contained implementation briefs: relevant plan
  excerpt + per-step success criteria (machine-checkable — "tests pass", not
  "works") + the scope triad — files this agent owns, files owned by sibling
  agents (do NOT touch, listed concretely), shared read-only context. Agents
  inherit nothing from this session — each brief must stand alone, and
  without the owned-by-others fence two agents on one tree collide in the
  shared import/index files.
- Every brief carries the executor contract (2026-07-14 · MAST, arXiv
  2503.13657 + LangChain harness-engineering): DONE requires EXECUTED
  verification —
  run the probe, return its output in `verification`; self-reading your own
  code is not verification (forced pre-completion verification moved a
  production harness +13.7pp, model fixed, and unverified self-approval plus
  step repetition are the two largest measured executor failure modes).
  Underspecified brief → return `clarify` with the question, never guess (a
  clarify return carries empty fields; the executed-verification requirement
  binds only done-claims).
  Same file edited 3+ times without the probe result changing → stop and
  return what you learned instead of iterating blind.
- Dependent steps → pipeline stages; independent steps → parallel items.
  The scaffold below runs `pipeline(A.steps, …)`, which starts EVERY item's
  implementer at once — items are parallel by construction. Milestones that
  build on each other (parse → check → interp) must NOT be items: write a
  serial `for (const s of A.steps) { await agent(…); await verify(…) }` loop
  instead, breaking on the first failed verdict. (2026-09-05 · stave phase 2:
  four dependent milestones dispatched as items; three correctly returned
  clarify on finding no crate, one run wasted.)
- Agents editing disjoint file sets share the working tree; use
  `isolation: 'worktree'` only when parallel agents would touch the same
  files, and then add an explicit merge stage — changed worktrees do not
  merge themselves.
- Before executing, surface the decomposition — one line per brief:
  `name · files · parallel? · mechanical?`. When the user is present and the
  plan spawns >3 agents or touches shared files, checkpoint via
  AskUserQuestion; otherwise proceed and carry the table into the report. A
  wrong split is cheapest to catch here, before the fan-out spends tokens.
- Unattended (`$CLAUDE_JOB_DIR` set, or no user present) that checkpoint does
  not vanish and does not become a guess: open a thread and keep working
  where you can —
  `id=$(docket open "<the question>" --kind decision --option "<A>" --option "<B>" --to "job:$(basename "$CLAUDE_JOB_DIR")" --body -)`
  with the decomposition table on stdin (`--to any` when not a job), then
  `docket wait "$id" --timeout 540` in a loop, re-waiting on 124. A return
  carrying `answer:` is the decision — act on it and `docket resolve` when the
  work lands; anything else is a question or a revised option set, so
  `docket reply` (a table when it asks for a comparison) and wait again.

**Success criteria**: A workflow script where every `agent()` call carries
`model: 'opus'` and every brief names its own success criteria and scope
triad.

### 3. Execute

Run the Workflow tool passing `args: {steps: [...]}` — the envelope object as
actual JSON, never a stringified blob. Returns are schema-forced on both
stages: free-prose reports invite exactly the charitable reading the verifier
is told to refuse, and a closed-world `pass` boolean is what makes failure
routable. Scaffold (API — `pipeline`, `opts.phase`, `opts.effort`, `schema`,
`meta.phases[].model` — verified against the live Workflow tool contract
2026-07-30; the `meta.phases` model key is display metadata, the per-agent
`model:` pin is what routes):

```js
export const meta = {
  name: "execute-plan",
  description: "Implement the approved plan; pinned opus agents, session model reviews after",
  phases: [
    { title: "Implement", model: "opus" },
    { title: "Verify", model: "opus" },
  ],
};
const IMPL = {
  type: "object",
  required: ["commands", "deviations", "filesTouched", "verification"],
  properties: {
    clarify: {
      type: "string",
      description:
        "set ONLY if the brief is underspecified — the blocking question; the other fields then carry empties and verification carries 'blocked — see clarify'",
    },
    commands: { type: "array", items: { type: "string" }, description: "commands run" },
    deviations: { type: "string", description: "every departure from the brief, or 'none'" },
    filesTouched: { type: "array", items: { type: "string" } },
    verification: {
      type: "string",
      description:
        "the verification you EXECUTED and its output — a done-claim without executed verification is invalid; 'blocked — see clarify' on a clarify return. PLAIN TEXT, under 3000 chars, no angle brackets or backslash escapes; every required key present in the SAME call (2026-07-20 · stele run: an implementer finished its work, then lost the whole report to 5 failed StructuredOutput attempts — omitted a required key while fighting escaping; the tree held the work but the workflow crashed)",
    },
  },
};
const VERDICT = {
  type: "object",
  required: ["evidence", "pass"],
  properties: {
    evidence: { type: "string", description: "probe output grounding the verdict" },
    pass: { type: "boolean" },
  },
};
// args has been observed arriving JSON-encoded — parse defensively.
const A = typeof args === "string" ? JSON.parse(args) : args;
const results = await pipeline(
  A.steps, // [{brief, mechanical, name, successCriteria}]
  (s) =>
    agent(s.brief, {
      ...(s.mechanical ? { effort: "low" } : {}),
      label: `implement:${s.name}`,
      model: "opus",
      phase: "Implement",
      schema: IMPL,
    }),
  (report, s) =>
    report == null
      ? { died: s.name } // dead implementer produced no code — never verify nothing
      : report.clarify
        ? { clarify: report.clarify, step: s.name } // answer it, re-dispatch — never let a guess proceed
        : agent(
            `Verify against these success criteria by running the probes yourself, at rung 3 of sequential-thinking's ladder — the report is a claim, not evidence (premise inheritance):\n${s.successCriteria}\n\nImplementer's report:\n${JSON.stringify(report)}`,
            { label: `verify:${s.name}`, model: "opus", phase: "Verify", schema: VERDICT },
          ).then((verdict) => ({ report, step: s.name, verdict })),
);
return results;
```

Steps that come back `pass: false` get re-dispatched once with the verifier's
evidence appended to the brief; a `died` step (no verdict exists — the
implementer produced nothing to verify) is re-dispatched once on the original
brief. Report a second failure as unimplemented, never as done; a reproducible
failure nobody can explain is /gigadebug material. A `clarify` return gets its question answered from the plan (or the
user) and the unit re-dispatched. Repair locally: hold passed units' results
and re-dispatch only the failed node and its dependents — never re-derive the
whole decomposition for one failure. For a genuinely high-uncertainty node,
dispatch N parallel attempts and let the verifier select (multi-attempt
roughly doubles hard-task success at N× cost — gate behind the same stakes
trigger as the gigareview escalation). For serial pipelines (dependent
steps), checkpoint-commit after each green step so a later failure rolls back
to the last good state; for parallel fan-outs, commit once after the step-4 review passes.

**Success criteria**: Workflow completes; every step has an implementer
report and a `pass: true` verdict.

### 4. Review in-session

The session model — the planner — reviews the actual diff against the plan:
`git diff`, run the test suite or the project's verify skill, judge every
reported deviation. Findings route back to pinned opus agents to fix; the
session model may apply only trivial one-line corrections where agent
overhead exceeds the edit. For unattended, production, or otherwise
high-stakes plans, hand this step to /gigareview instead — it is the house
adversarial-review protocol (stakes-calibrated lens hunt, live premise
probes, GO/NO-GO); the inline pass above is the low-stakes path.

**Success criteria**: Diff matches the plan or every divergence has a named
reason; full test/verify pass green.

### 5. Report

What shipped vs. the plan, deviations and why, test results, residual risk.

**Success criteria**: The user can accept the work from this report alone.

## Detached variant

When execution should outlive this session or free the terminal, launch the
executor headless in the background instead of steps 2–3:

```sh
cd <target-repo> && claude -p --model opus --permission-mode acceptEdits \
  "ultracode: execute the plan at <absolute-plan-path> exactly; report all deviations"
```

Run via Bash with `run_in_background: true`; review here (step 4) when it
exits. Step 1 (repo confirmation) still runs first, and three things in the
command are mandatory: the absolute plan path, the `cd` to the confirmed repo,
and `--model opus`. `acceptEdits` auto-accepts file edits with no human
present, so a wrong cwd means unattended edits in the wrong repository;
headless runs use the CLI's configured default model, not any pin from this
session. Unlike unattended sweeps,
do NOT strip settings sources — the executor needs project permissions and
skills.

## Rules

- Deviations get reported, never silently absorbed — the plan file is the contract.
- Every `agent()` call pins `model:`; an unpinned call is a bug, not a default.
- Shared-tree parallelism (since 2026-07-19 · realtime-agent P1 — a retry agent wiped two siblings' verified work):
  - Scope criteria must be phrased per-step ("X untouched BY THIS STEP"), never absolutely ("only X changed") — parallel agents legitimately dirty the shared tree, and verifiers told to check absolute cleanliness fail correct work.
  - Tell every verifier explicitly: sibling agents' uncommitted changes in other paths are EXPECTED and are not a scope violation.
  - A verdict that fails ONLY on scope in a shared tree routes to the session model for adjudication — never into the automatic retry path; auto-retry is for substantive failures.
  - Every brief — retries doubly so — carries: NEVER run git checkout/reset/clean/stash/switch; the working tree is shared with concurrent agents and prior uncommitted deliverables.
  - Recovery note: implementer file writes are replayable from their transcripts (agent-*.jsonl tool_use blocks) — reconstruct before re-running expensive implementations.
- Worktree isolation caveat (observed 2026-07-19): `isolation: 'worktree'` created the worktree from the WRONG git root (the user's home dotfiles repo, not the project repo the session cwd was in). Brief every worktree agent to verify the worktree actually contains the project (check for a landmark file) before working, and to self-relocate to a scratchpad copy if not — never to fall back to editing the shared main tree.
