# Claude Code prompt architecture — reference for prompt-system builders

Companion to `SKILL.md`. Where `SKILL.md` teaches how to _author_ a prompt, this document explains how Claude Code _assembles, evolves, delegates, and preserves_ prompts at runtime. Read this when:

- You're building a system that composes prompts dynamically.
- You're adding a new attachment type or hook.
- You're designing a sub-agent that must share cache with its parent.
- You're trying to understand why your prompt cache is missing.
- You're authoring a SKILL.md that needs to survive compaction.

Distilled from Claude Code's source; `file:line` citations are pinned to a point-in-time snapshot and may drift against current Claude Code.

---

## 1. The five fundamentals

Claude Code's prompt system rests on five mechanisms that no amount of static-prompt reading will reveal:

1. **Composition** — the system prompt is a _function of runtime state_. A single `getSystemPrompt()` call composes 14+ sections from feature flags, user type, enabled tools, mode, platform. The final bytes are never hand-written.
2. **Cache-scoped delivery** — the composed prompt is delivered as multiple `TextBlockParam` entries with `cache_control` at varying scopes (`global`, `org`, or null). A boundary marker splits statically-cacheable content from session-variant content.
3. **Attachments** — mid-conversation prompt content arrives as typed attachments (~40+ types) that render per-turn, dedup via per-attachment-type state, and smoosh into tool_results for cache stability.
4. **System-reminders** — the `<system-reminder>` tag creates an _orthogonal instruction channel_: content that's positionally adjacent to a tool_result but semantically independent from it. The "non-relational" guarantee is enforced by the model's training.
5. **Delegation** — sub-agents either _fork_ (inherit parent's byte-exact system prompt for cache-sharing) or _spawn fresh_ (clean persona + env info). Background agents run in isolation; their completion appears as a synthetic user message on a later turn.

Every architectural decision below flows from these five.

---

## 2. System-prompt composition

### Entry point

**`getSystemPrompt(tools, model, additionalWorkingDirectories?, mcpClients?)`** in `constants/prompts.ts:444` composes the full system prompt from runtime inputs. Callers: `QueryEngine`, `claude.ts` (API delivery), `runAgent.ts` (sub-agents via a different path — see §4).

### Section catalog

The output is `Array<string>` with a boundary marker in the middle. Assembly (`prompts.ts:560-576`):

```typescript
return [
  // STATIC (pre-boundary, cacheable at 'global' scope)
  getSimpleIntroSection(outputStyleConfig),
  getSimpleSystemSection(),
  outputStyleConfig === null || outputStyleConfig.keepCodingInstructions === true
    ? getSimpleDoingTasksSection()
    : null,
  getActionsSection(),
  getUsingYourToolsSection(enabledTools),
  getSimpleToneAndStyleSection(),
  getOutputEfficiencySection(),

  // BOUNDARY MARKER (filtered out during API delivery)
  ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),

  // DYNAMIC (post-boundary, 'org' or no cache)
  ...resolvedDynamicSections, // session_guidance, memory, env, language, outputStyle, mcpInstructions, scratchpad, …
].filter((s) => s !== null);
```

| #     | Section                                                                               | Gate                                                        | Zone                            |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| 1     | Intro (identity + output-style frame)                                                 | `outputStyleConfig` branches                                | static                          |
| 2     | System (permissions, `<system-reminder>`, hooks, auto-compaction)                     | always                                                      | static                          |
| 3     | Doing tasks (code-style discipline)                                                   | `outputStyle.keepCodingInstructions !== false`              | static                          |
| 4     | Executing actions with care                                                           | always                                                      | static                          |
| 5     | Using your tools                                                                      | `enabledTools` set; REPL mode skips file-tool guidance      | static                          |
| 6     | Tone and style (emojis, file:line, owner/repo#123, no colon before tool calls)        | always                                                      | static                          |
| 7     | Output efficiency                                                                     | `USER_TYPE === 'ant'` gets expanded variant                 | static                          |
| **—** | **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`**                                                  | `shouldUseGlobalCacheScope()`                               | **marker**                      |
| 8     | Session-specific guidance (AskUserQuestion, Fork, Explore/Plan, Skills, Verification) | many sub-gates                                              | dynamic                         |
| 9     | Memory (`.claude/memory/MEMORY.md`)                                                   | file exists                                                 | dynamic                         |
| 10    | Ant model override                                                                    | `USER_TYPE === 'ant' && !undercover`                        | dynamic                         |
| 11    | Env (cwd, git status, platform, shell, OS, model, knowledge cutoff, fast mode, IDE)   | always                                                      | dynamic                         |
| 12    | Language preference                                                                   | `settings.language` set                                     | dynamic                         |
| 13    | Output style                                                                          | `outputStyleConfig !== null`                                | dynamic                         |
| 14    | MCP instructions                                                                      | `mcpClients.length > 0 && !isMcpInstructionsDeltaEnabled()` | dynamic (breaks cache per-turn) |
| 15    | Scratchpad                                                                            | `isScratchpadEnabled()`                                     | dynamic                         |
| 16    | Function-result clearing                                                              | `feature('CACHED_MICROCOMPACT') && modelSupports`           | dynamic                         |
| 17    | Summarize tool results                                                                | always                                                      | dynamic                         |
| 18    | Numeric length anchors (≤25 / ≤100 words)                                             | `USER_TYPE === 'ant'`                                       | dynamic                         |
| 19    | Token budget                                                                          | `feature('TOKEN_BUDGET')`                                   | dynamic                         |
| 20    | Brief section                                                                         | `feature('KAIROS') \|\| feature('KAIROS_BRIEF')`            | dynamic                         |

### Cache-boundary discipline

**Rule:** static sections are cacheable at `scope: 'global'` (shared across ALL Anthropic orgs). Dynamic sections are either `scope: 'org'` (session-local) or uncached.

```typescript
// constants/prompts.ts:114-115
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__';
```

The marker is a sentinel string. It's placed in the array, then **filtered out** during API assembly. `splitSysPromptPrefix()` (`api.ts:321-435`) finds it and splits the array into cache blocks.

**Three API delivery paths** based on MCP presence + `shouldUseGlobalCacheScope()`:

| Path                               | Blocks emitted                                                   | When                                                   |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| MCP-present + global-feature-off   | `[null attribution, 'org' prefix, 'org' everything]`             | default 1P + MCP                                       |
| Global-feature-on + boundary found | `[null attribution, null prefix, 'global' static, null dynamic]` | 1P, no-MCP, global cache enabled — **cross-org reuse** |
| Default (3P, or no global)         | `[null attribution, 'org' prefix, 'org' everything]`             | fallback                                               |

### Memoization

`systemPromptSection(name, compute)` in `systemPromptSections.ts` caches a section's output until `/clear` or `/compact`. Returns cached string on subsequent calls.

**`DANGEROUS_uncachedSystemPromptSection(name, compute, reason)`** — used only for MCP instructions, which change when servers connect/disconnect mid-session. Breaks cache every turn; documented reason field is required for audit.

The dynamic-section list is built once per prompt assembly and the individual sections are memoized:

```typescript
const dynamicSections = [
  systemPromptSection('session_guidance', () =>
    getSessionSpecificGuidanceSection(enabledTools, skillToolCommands),
  ),
  systemPromptSection('memory', () => loadMemoryPrompt()),
  DANGEROUS_uncachedSystemPromptSection(
    'mcp_instructions',
    () => getMcpInstructionsSection(mcpClients),
    'MCP servers can connect/disconnect mid-session',
  ),
  // ...
];
const resolvedDynamicSections = await resolveSystemPromptSections(dynamicSections);
```

### API delivery shape

`buildSystemPromptBlocks()` (`claude.ts:3213-3237`) maps each array element to a `TextBlockParam`:

```typescript
return splitSysPromptPrefix(systemPrompt, opts).map((block) => ({
  type: 'text' as const,
  text: block.text,
  ...(enablePromptCaching &&
    block.cacheScope !== null && {
      cache_control: getCacheControl({ scope: block.cacheScope, querySource }),
    }),
}));
```

The API receives:

```js
{
  system: [
    { type: 'text', text: '...attribution...' },                                    // no cache
    { type: 'text', text: '...prefix...',  cache_control: { scope: 'org' } },
    { type: 'text', text: '...static...',  cache_control: { scope: 'global' } },   // cross-org
    { type: 'text', text: '...dynamic...' }                                         // no cache
  ],
  messages: [...]
}
```

### Sub-agent composition

Sub-agent system prompts come from `getAgentSystemPrompt()` in `runAgent.ts:906-932`:

```typescript
const agentPrompt = agentDefinition.getSystemPrompt({ toolUseContext }); // the persona
const prompts = [agentPrompt];
return await enhanceSystemPromptWithEnvDetails(
  prompts,
  resolvedAgentModel,
  additionalWorkingDirectories,
  enabledToolNames,
);
```

**Result shape** (`prompts.ts:760-791`):

```
[agent persona from getSystemPrompt()]
Notes: [agent-specific notes about absolute paths, no emojis, etc.]
[discover-skills guidance if feature + enabled tool]
# Environment
[computeEnvInfo: cwd, git, platform, shell, OS, model, knowledge cutoff, …]
```

Sub-agents do NOT inherit the main conversation's system prompt sections (Tone and style, Using your tools, etc.) — just their own persona + env.

**`omitClaudeMd: true`** on read-only agents (Explore, Plan) skips loading CLAUDE.md — saves 5–15 Gtok/week at fleet scale.

### Fork byte-identity

Forks must share the parent's prompt cache. To guarantee byte-identity:

```typescript
// runAgent.ts:508-518
const agentSystemPrompt = override?.systemPrompt     // fork passes parent's rendered bytes
  ? override.systemPrompt
  : asSystemPrompt(await getAgentSystemPrompt(...))  // fresh agents recompute
```

Forks pass `override.systemPrompt = <parent's already-rendered bytes>` via `toolUseContext.renderedSystemPrompt`. Recomputing via `getSystemPrompt()` can diverge on GrowthBook cold→warm state and miss the cache. The override mechanism is the only way to guarantee the prefix hash matches.

**`useExactTools=true`** on forks preserves the parent's tool schema in the API request too — otherwise the tool JSON changes and the cache misses on tool definitions.

### Output styles

Markdown files in `.claude/output-styles/` or `~/.claude/output-styles/` with frontmatter (`name`, `description`, `keep-coding-instructions`). Loaded by `getOutputStyleConfig()`. Layer on the base prompt:

- **Intro** is reframed ("helps users according to your Output Style below" vs "with software engineering tasks")
- **Doing tasks** is _omitted_ if `keep-coding-instructions: false`
- **A dedicated section** (`# Output Style: <name>`) is injected post-boundary

---

## 3. Runtime prompt evolution

### The attachment pipeline

`getAttachments(input, toolUseContext, ideSelection, queuedCommands, messages?, querySource?)` in `utils/attachments.ts:743-992` computes per-turn attachments. Two phases in parallel:

```
┌─ user input phase (only if there's new user text) ──┐
│  • at_mentioned_files                               │
│  • mcp_resources                                    │
│  • agent_mentions                                   │
│  • skill_discovery (turn-0 AKI prefetch)            │
└──────────────────────────────────────────────────────┘
                        ∥ (Promise.all)
┌─ thread-safe phase (every turn) ────────────────────┐
│  • queued_commands, date_change, ultrathink_effort  │
│  • deferred_tools_delta                             │
│  • agent_listing_delta, mcp_instructions_delta      │
│  • changed_files, nested_memory                     │
│  • dynamic_skill, skill_listing                     │
│  • plan_mode, auto_mode                             │
│  • todo_reminders, teammate_mailbox                 │
│  • critical_system_reminder, compaction_reminder    │
└──────────────────────────────────────────────────────┘
                        ∥
┌─ main-thread-only phase (IDE, diagnostics) ─────────┐
│  • ide_selection, ide_opened_file                   │
│  • output_style, diagnostics, lsp_diagnostics       │
│  • unified_tasks, async_hook_responses              │
│  • token_usage, budget_usd                          │
└──────────────────────────────────────────────────────┘
                        ↓
          getAttachmentMessages() → UserMessage[]
                        ↓
        wrapMessagesInSystemReminder() for most types
                        ↓
        smooshSystemReminderSiblings() merges into prior tool_result
                        ↓
                 API request
```

Each attachment resolver is wrapped with `maybe(type, fn)` which catches rejections — no single failure breaks the whole turn.

### Attachment type catalog

| Type                                                    | Fires                                                                   | Content                                 | SR-wrapped              | Dedup                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- | ----------------------- | ---------------------------------------------------- |
| `at_mentioned_files`                                    | user `@path`                                                            | File contents (text/image/pdf/notebook) | yes                     | `readFileState` mtime check                          |
| `already_read_file`                                     | same file, unchanged                                                    | "You already read this at turn N"       | yes                     | mtime cache hit                                      |
| `edited_text_file`                                      | file modified out-of-band                                               | Snippet with line numbers               | yes                     | file watcher                                         |
| `directory`                                             | user `@dir/`                                                            | `ls` output                             | yes (tool-result shape) | per-turn                                             |
| `selected_lines_in_ide`                                 | IDE selection                                                           | Code snippet (0–2000 chars)             | yes                     | `ideSelection` param                                 |
| `opened_file_in_ide`                                    | IDE file open                                                           | Filename only                           | yes                     | per-turn                                             |
| `todo_reminder`                                         | 6+ turns since TodoWrite + 4+ since last reminder                       | Current list                            | yes                     | turn-count gated                                     |
| `task_reminder`                                         | same pattern for tasks                                                  | Current list                            | yes                     | turn-count gated                                     |
| `nested_memory`                                         | file op triggers dir traversal                                          | CLAUDE.md from discovered dirs          | yes                     | per-turn                                             |
| `relevant_memories`                                     | async prefetch per-turn                                                 | Query-matched memory files              | yes                     | pre-computed stable headers + `readFileState` dedup  |
| `dynamic_skill`                                         | file op discovers a `SKILL.md` sibling                                  | Newly-available skill names             | **no** (empty body)     | `dynamicSkillDirTriggers.clear()` post-collection    |
| `skill_listing`                                         | turn 0 + plugin reload + not suppressed                                 | Formatted command table                 | yes                     | `sentSkillNames` per-agent `Map<agentId, Set<name>>` |
| `skill_discovery`                                       | turn 0 (EXPERIMENTAL_SKILL_SEARCH)                                      | Name+description list                   | yes                     | blocking AKI prefetch                                |
| `queued_command`                                        | mid-turn drain + task notifications                                     | Prompt or blocks                        | conditional             | `removeFromQueue`                                    |
| `output_style`                                          | per-turn (if non-default)                                               | Style name + prompt                     | no                      | settings lookup                                      |
| `plan_mode`                                             | each turn in plan mode                                                  | Full or sparse reminder                 | yes                     | full every turn, sparse every 3                      |
| `plan_mode_exit`                                        | exit plan mode                                                          | Plan file info                          | yes                     | one-time                                             |
| `auto_mode`                                             | each turn (TRANSCRIPT_CLASSIFIER)                                       | Full or sparse reminder                 | yes                     | full every turn, sparse every 3                      |
| `auto_mode_exit`                                        | exit auto mode                                                          | (empty)                                 | yes                     | one-time                                             |
| `agent_listing_delta`                                   | per-turn                                                                | added/removed agent types               | yes                     | delta from prior attachments                         |
| `mcp_instructions_delta`                                | per-turn (delta mode on)                                                | Per-server diff                         | yes                     | diff via `getMcpInstructionsDelta`                   |
| `critical_system_reminder`                              | `toolUseContext.criticalSystemReminder_EXPERIMENTAL` set                | String                                  | yes (pre-wrapped)       | per-turn                                             |
| `hook_additional_context`                               | `PreToolUse`/`PostToolUse`/`UserPromptSubmit` emits `additionalContext` | String                                  | yes                     | per hook                                             |
| `hook_system_message`                                   | hook-authored warning                                                   | String                                  | yes                     | per hook                                             |
| `hook_blocking_error`, `hook_success`, `hook_cancelled` | sync hook completion                                                    | stdout/stderr/exit                      | yes                     | per execution                                        |
| `diagnostics`                                           | IDE + LSP                                                               | File diagnostics                        | yes                     | `isNew` flag                                         |
| `team_context`                                          | agent swarms enabled                                                    | Team/agent/paths                        | yes                     | per-turn                                             |
| `teammate_mailbox`                                      | per-turn (skip session_memory fork)                                     | DM messages                             | yes                     | per-turn fetch + mark-read                           |
| `date_change`                                           | calendar day changed                                                    | Date string                             | yes                     | per-turn check                                       |
| `deferred_tools_delta`                                  | per-turn                                                                | added/removed deferred tool names       | yes                     | delta                                                |
| `compaction_reminder`                                   | `feature('COMPACTION_REMINDERS')`                                       | Token estimate                          | yes                     | input-token check                                    |
| `context_efficiency`                                    | `feature('HISTORY_SNIP')`                                               | Efficiency rating                       | yes                     | history-derived                                      |

### System-reminder semantics

```typescript
// messages.ts:3097-3099
export function wrapInSystemReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`;
}
```

**Idempotent** (`messages.ts:1795`): `if (content.startsWith('<system-reminder>')) return msg`.

**Non-relational** (`constants/prompts.ts:132, 190`) — quoted verbatim in SKILL.md. The mechanical purpose: when `<system-reminder>` text sits as a sibling block next to a `tool_result` in a user message, the model must treat them as independent streams. Without this training guarantee, models conflate system notes with task-continuation.

### The smoosh operation

Most attachments render as user messages with `<system-reminder>`-wrapped text. When one of those messages _also_ contains a `tool_result` (because an attachment fired on the same turn as a tool call resolved), `smooshSystemReminderSiblings()` merges the reminder text _into_ the tool_result's content array.

**Before:**

```
{ type: 'user', content: [
  { type: 'tool_result', tool_use_id: 'x', content: 'ls output...' },
  { type: 'text', text: '<system-reminder>\n…\n</system-reminder>' },
]}
```

**After:**

```
{ type: 'user', content: [
  { type: 'tool_result', tool_use_id: 'x',
    content: 'ls output...\n\n<system-reminder>\n…\n</system-reminder>' },
]}
```

Purpose:

1. **Cache stability** — message layout doesn't shift as attachments fire.
2. **Model focus** — reminders stay positionally glued to the tool output they annotate (even though the non-relational rule means semantically they could be anywhere).
3. **Idempotence** — applying twice finds nothing to extract.

Bail-outs: if the tool_result contains a `tool_reference` block or is an error, smoosh skips it (`messages.ts:2534-2598`).

### Hook lifecycle

| Hook                       | Fires                 | Output                                                    | Attachment                             | Model sees it as                                               |
| -------------------------- | --------------------- | --------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `SessionStart`             | before turn 0         | `additionalContext`, `initialUserMessage`, `watchPaths`   | prepended to first user message        | session-initial content                                        |
| `UserPromptSubmit`         | user hits enter       | `additionalContext`                                       | `hook_additional_context`              | meta user message, SR-wrapped, `<user-prompt-submit-hook>` tag |
| `PreToolUse`               | before tool call      | `permissionDecision`, `updatedInput`, `additionalContext` | `hook_additional_context` + permission | sibling to forthcoming tool_result, smooshed                   |
| `PostToolUse`              | after tool returns    | `additionalContext`, `updatedMCPToolOutput`               | `hook_additional_context`              | sibling to tool_result, smooshed                               |
| `PostToolUseFailure`       | tool errored          | `additionalContext`                                       | `hook_additional_context`              | same                                                           |
| `Stop`                     | model stop            | (async only, fire-and-forget)                             | —                                      | not model-visible                                              |
| `PreCompact`/`PostCompact` | compaction boundaries | logging                                                   | —                                      | not model-visible                                              |
| `PermissionRequest`        | permission prompt     | `decision`                                                | —                                      | syncs into permission flow                                     |

The **"hook feedback is from the user"** contract in the main system prompt (`constants/prompts.ts:128`) lets hooks deliver domain-specific corrections that the model treats as user agency ("adjust your approach") rather than as bureaucratic blocks.

### Dynamic-event catalog

| Event                        | Trigger                                                | Mechanism                                                              | Dedup                                             |
| ---------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------- |
| Skill discovery              | turn-0 user input                                      | blocking AKI prefetch → `skill_discovery` attachment                   | none (turn-0 only)                                |
| Dynamic skill discovery      | file-op discovers nested `.claude/skills/`             | `discoverSkillDirsForPaths()` walks dir tree → `addSkillDirectories()` | `dynamicSkillDirTriggers.clear()` post-collection |
| Conditional skill activation | file op matches a skill's `paths:` pattern             | `activateConditionalSkillsForPaths()`                                  | `activatedConditionalSkillNames` Set              |
| Skill listing                | turn-0 + plugin reload + after `resetSentSkillNames()` | diff `allCommands` against `sentSkillNames.get(agentId)`               | per-agent Set                                     |
| Memory refresh               | async prefetch spawned per-turn                        | `startRelevantMemoryPrefetch()` → side LLM query for term extraction   | `readFileState` + `consumedOnIteration`           |
| MCP instructions delta       | per-turn (when delta mode on)                          | `getMcpInstructionsDelta()` diffs prior attachment against current     | delta reconstruction from transcript              |
| Agent listing delta          | per-turn                                               | diff from prior `agent_listing_delta` attachments                      | same                                              |
| Plugin reload                | `/reload-plugins`                                      | `resetSentSkillNames()` → next turn re-injects full listing            | fresh                                             |
| --resume                     | session load                                           | `suppressNextSkillListing()` if transcript already has one             | one-time suppression                              |

### Conversation recovery (--resume)

`deserializeMessagesWithInterruptDetection()` in `utils/conversationRecovery.ts`:

1. Migrate legacy attachment types (schema evolution).
2. Strip invalid `permissionMode` values.
3. Filter unresolved tool uses, orphaned thinking-only messages, whitespace-only assistants.
4. If transcript contains a prior `skill_listing` attachment, call `suppressNextSkillListing()` — otherwise the re-spawned process would inject a duplicate ~4K-token listing.
5. Rebuild state for the query loop.

---

## 4. Delegation

### Fork vs fresh sub-agent

| Aspect              | Fork (`!subagent_type`)                                                  | Fresh (`subagent_type: X`)                          |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| Context inheritance | full parent conversation (including images, tool results)                | zero — must brief in `prompt`                       |
| System prompt       | parent's byte-exact rendered bytes (override)                            | agent's own persona + env scaffolding               |
| Tool pool           | parent's exact tools (for cache match)                                   | agent's `tools: ['*']` or restricted list           |
| Permission mode     | parent's (e.g. `bubble` surfaces to parent terminal)                     | agent's `permissionMode` override                   |
| Prompt contract     | **directive** — what to do, given context                                | **descriptive** — situation + intent + output shape |
| Model               | inherited (cache-sharing requirement)                                    | agent's `model` or call param                       |
| Execution           | always async                                                             | sync (default) or `run_in_background: true`         |
| Cache               | all forks share parent prefix → high hit rate                            | fresh prefix → no sharing                           |
| Recursion guard     | fork-of-fork rejected via `isInForkChild()` (checks for boilerplate tag) | can spawn forks                                     |
| Thinking            | inherits parent's thinking config                                        | disabled by default (cost control)                  |

### Spawn flow

```
AgentTool.call() validates input
  ↓
resolveAgent() picks definition from registry
  ↓
buildForkedMessages() — fork path
  OR
createUserMessage() — fresh path
  ↓
createSubagentContext(parent, overrides):
  • new abortController (async) or shared (sync)
  • cloned readFileState, contentReplacementState
  • stubbed setAppState (async) or shared (sync)
  • new agentId, chainId, depth++
  ↓
runAgent() async generator yields Messages
  ↓
AgentTool collects → finalizeAgentTool() → ToolResult
```

Same `query()` loop the main conversation runs — tool calls, compaction triggers, error recovery are shared machinery.

### Fork boilerplate

Forks prepend a boilerplate block to the directive (`forkSubagent.ts:172-198`):

```
<fork-worker-directive>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Your system prompt says "default to forking." IGNORE IT — that's for the parent.
2. Do NOT converse, ask questions, or suggest next steps.
3. USE your tools directly … then report once at the end.
…
Output format:
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer>
  Key files: <paths>
  Files changed: <list with commit hash>
  Issues: <list>
</fork-worker-directive>
```

The boilerplate tag also serves as the `isInForkChild()` detector for recursion prevention.

### Result marshaling

**Sync:** `runAgent` yields messages → `AgentTool` collects → `finalizeAgentTool()` returns `ToolResult` → caller receives in same turn.

**Async (`run_in_background: true`):**

1. `runAgent` spawned in separate JS closure.
2. Returns immediately with `{ status: 'async_launched', agentId, taskId, outputFile }`.
3. Agent runs → `completeAsyncAgent()` on finish.
4. `enqueueAgentNotification()` posts `<task-notification>` XML to stdout.
5. Print loop's `drainCommandQueue` detects marker, injects synthetic user message on next turn.

The `output_file` path is documented but intentionally off-limits to the spawning agent — "Don't peek" (quoted verbatim in SKILL.md and the Agent tool prompt).

### Background agent isolation

- `setAppState` stubbed — permission prompts don't bubble to parent.
- New unlinked `AbortController` — parent can't kill the child.
- Cloned `readFileState` — file cache independent.
- `setAppStateForTasks` remains live — task tracking reaches root store even when regular app state is stubbed.
- Response metrics callback shared — token counts aggregate.

### Nested depth

`queryTracking.depth` increments on every sub-agent spawn (`forkedAgent.ts:452`). Main = 0, sub-agents = 1, nested = 2+. Used for analytics (`invocation_trigger: 'nested-skill'` when depth > 0). **No prompt changes** at deeper nesting currently.

### Forked-skill invocation

When a skill has `context: fork`, `SkillTool.executeForkedSkill()` routes through `runAgent()` instead of inline injection:

```typescript
for await (const message of runAgent({
  agentDefinition: baseAgent,
  promptMessages, // skill body as user messages
  toolUseContext: { ...context, getAppState: modifiedGetAppState },
  canUseTool,
  isAsync: false, // skills always sync
  querySource: "agent:custom",
  availableTools: context.options.tools,
  override: { agentId },
})) {
  agentMessages.push(message);
}
addInvokedSkill(commandName, skillPath, finalContent, agentId);
```

The skill runs in a sub-agent with its own token budget; the parent's context stays clean. `addInvokedSkill()` registers the skill for compaction preservation.

---

## 5. Compaction

### Triggers

- **Auto** when input tokens exceed threshold (~400K default) → `query.ts:454` calls `deps.autocompact()`.
- **Manual** `/compact` command.
- **Reactive** on API `prompt_too_long` errors.

### Three variants

```typescript
// services/compact/prompt.ts
BASE_COMPACT_PROMPT; // full conversation → summary (replaces everything pre-boundary)
PARTIAL_COMPACT_PROMPT; // summary of recent messages only, older content kept intact
PARTIAL_COMPACT_UP_TO_PROMPT; // partial with suffix preservation (for session memory)
```

All three open with `NO_TOOLS_PREAMBLE` (_"CRITICAL: Respond with TEXT ONLY. Do NOT call any tools…"_) and close with `NO_TOOLS_TRAILER`. Output is `<analysis>` scratchpad + `<summary>` with 9 numbered sections:

1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections (with snippets)
4. Errors and fixes
5. Problem Solving
6. All user messages (non-tool-result only)
7. Pending Tasks
8. Current Work
9. Optional Next Step

`formatCompactSummary()` strips the `<analysis>` block; only `<summary>` reaches the post-compact context.

### Preservation mechanics

**`invokedSkills` state** in `bootstrap/state.ts:178-187`:

```typescript
invokedSkills: Map<
  `${agentId}:${skillName}`,
  {
    skillName;
    skillPath;
    content;
    invokedAt;
    agentId;
  }
>;
```

Intentionally **not cleared** during compaction (`postCompactCleanup.ts:65-69`). A skill's full markdown body survives multiple compactions so post-compact attachments can re-inject it verbatim. This costs memory but saves the tokens of re-fetching and re-rendering skill files.

**Post-boundary messages** — `getMessagesAfterCompactBoundary(messages)` returns messages after the compact marker. These stay in context as-is.

**Attachments re-run** — `agent_listing_delta`, `skill_listing` (if not suppressed), hook results all fire fresh per-turn, so they're "re-injected" organically.

### Post-compact cleanup

`runPostCompactCleanup(querySource?)` in `postCompactCleanup.ts:31-77`:

```typescript
const isMainThreadCompact =
  querySource === undefined || querySource.startsWith('repl_main_thread') || querySource === 'sdk';

resetMicrocompactState();
if (feature('CONTEXT_COLLAPSE') && isMainThreadCompact) resetContextCollapse();
if (isMainThreadCompact) {
  getUserContext.cache.clear?.(); // re-read CLAUDE.md
  resetGetMemoryFilesCache('compact'); // re-check memory files
}
clearSystemPromptSections(); // rebuild pwd, git status, etc.
clearClassifierApprovals();
clearSpeculativeChecks(); // bash permission checks stale
clearBetaTracingState();
clearSessionMessagesCache();
// NOTE: NOT calling resetSentSkillNames() — skills must survive
```

`isMainThreadCompact` distinguishes parent-level compaction from sub-agent compactions. Sub-agent compactions don't clear module-level state (they'd corrupt the parent, since they run in the same process).

### Cache implications

After compaction:

- System prompt sections (pwd, git status, enabled tools) are cleared and rebuilt — **prefix bytes change** → cache miss possible.
- Skill content is preserved in state → re-injected at the same shape → cache-stable for skills.
- MCP tool schemas unchanged → tool block cache-stable.
- Permission mode, model, features unchanged → prefix-relevant flags stable.

Net effect: compaction **usually** breaks cache once (prefix rebuild) then stabilizes. The `pendingPostCompaction` marker tags the first post-compact API call so analytics can distinguish compaction-induced misses from TTL expiry.

---

## 6. Cache architecture (cross-cutting)

### Three scopes

- **`global`**: cross-org reuse. Only for the static section prefix when `shouldUseGlobalCacheScope()` is on and no MCP is active. The highest-value cache tier — one cache entry serves all users of a given CC version.
- **`org`**: per-org session cache. The default. Covers session-specific but stable content.
- **`null`**: no cache. Attribution header, per-user env, volatile content.

### Prefix-stability discipline

Anything that changes per-org or per-user **must not** live above the boundary:

- Git status, cwd → dynamic section (`env`), null cache.
- MCP server list → dynamic section (`mcp_instructions`), `DANGEROUS_uncached`.
- Memory files → dynamic section (`memory`).
- User preferences → dynamic section (`language`, `outputStyle`).

Feature flags that toggle **sections** can still live above (the marker is just "this section exists / doesn't"). Feature flags that change section _text_ bifurcate the cache and should be minimized.

### Sticky latches

Certain flags latch on for the session to prevent mid-session cache busts:

- `afkModeHeaderLatched` — AFK mode header, sticky once set.
- `cacheEditingHeaderLatched` — cache-editing header.

Pattern: once a session has seen a feature on, it stays on regardless of later state changes. Prevents toggle-induced cache misses.

### Fork cache inheritance

Forks preserve cache by:

1. `override.systemPrompt = parent's rendered bytes` (byte-exact prefix).
2. `useExactTools=true` (byte-exact tool schemas).
3. Same model, same thinking config.
4. Only the final user message (directive) differs per fork child.

Ten parallel forks hit the same cached prefix ten times.

### Compaction-induced cache instability

See §5. Compaction is the one event that reliably changes the prefix (via system-prompt-section rebuild). Plan for it: the first API call after compaction pays full creation tokens; subsequent calls are warm again.

---

## 7. Query loop and error recovery

The query loop (`query.ts`) is a generator that yields messages while managing recovery from ~8 distinct failure modes. Prompt injection happens at loop points, between the model's turns — not inside the model's response.

### The withholding pattern

When the streaming API returns `prompt_too_long` (413) or a media-size error, the loop does **not** yield the error to the model. It sets a flag (`withheldByCollapse`, `withheldByReactive`), collects the error, and tries staged recovery:

1. `contextCollapse.recoverFromOverflow()` — drain the context-collapse archive into the prompt window.
2. If that fails: `reactiveCompact.tryReactiveCompact()` — invoke `query()` recursively at `depth+1` with `querySource: 'reactive_compact'` to produce a summary.
3. If both fail: surface the withheld error to the user (not the model).

**Design rule**: recoverable errors never reach the model. Only unrecoverable ones become visible context.

### Loop-injected prompt catalog

Seven verbatim prompts the harness injects at loop boundaries:

| Trigger                    | Model-visible text                                                                                                                                                                          | File                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `max_output_tokens` hit    | _"Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."_ | `query.ts:1225`      |
| User interrupt (streaming) | `[Request interrupted by user]`                                                                                                                                                             | `messages.ts:207`    |
| User interrupt (tool use)  | `[Request interrupted by user for tool use]`                                                                                                                                                | `messages.ts:208`    |
| Model fallback             | _"Switched to {fallbackModel} due to high demand for {originalModel}"_ (system message, not user)                                                                                           | `query.ts:945`       |
| Stop hook blocking         | _"Stop hook feedback:\n{text}"_ (variants: `TeammateIdle`, `TaskCompleted`, `TaskCreated`, `UserPromptSubmit`)                                                                              | `hooks.ts:1894-1940` |
| Token-budget continuation  | _"Stopped at {pct}% of token target ({turnTokens} / {budget}). Keep working — do not summarize."_                                                                                           | `query.ts:1325`      |
| 413 display                | _"Prompt is too long"_ (generic display text; raw details in `errorDetails`)                                                                                                                | `errors.ts:62`       |

### Three patterns worth naming

1. **"Resume directly — no apology, no recap."** Post-interruption directive. Prevents the model from spending output tokens re-narrating or apologizing when it has to pick up mid-thought. Reusable whenever an agent continues after a forced pause.

2. **"Keep working — do not summarize."** Token-budget continuation directive. The budget isn't a stop — it's a nudge. The explicit "don't summarize" prevents the model from treating budget hits as natural conclusion points.

3. **Death-spiral prevention.** Stop hooks are **skipped** when the model's last message is an API error. A hook that injects tokens on every response would keep firing as the error keeps returning. Rule of thumb for hook design: never run hooks on error-only responses — the error is probably why they'd be firing.

### Other mechanics

- **Post-sampling hooks are fire-and-forget.** `void executePostSamplingHooks(...)` — not awaited, never inject into the main query. Analytics and side-effects only.
- **Max-output-token recovery is capped.** Three attempts with the "Resume directly" injection; after 3, the error surfaces.
- **Thinking-signature stripping on fallback (Ant only).** When the model switches mid-turn, `redacted_thinking` blocks are stripped — otherwise the new model returns 400 ("thinking blocks cannot be modified").
- **Submit-interrupt skips the synthetic message.** If the user interrupts by submitting a new prompt, the next user message is already queued — no need to inject `[Request interrupted by user]`.

---

## 8. Mode-specific prompts

Four dimensions that change what the model sees: **mode** (plan / auto / default / bare), **permission mode** (default / acceptEdits / bypassPermissions / dontAsk / plan), **session type** (interactive / headless / `--resume`), **user type** (`ant` / external).

### Permission modes are gates, not prompt changes

The model always sees the same permission-related text (`constants/prompts.ts:189`). The mode dictates whether a tool call is auto-approved, auto-denied, or surfaces a user prompt — the model is **unaware** which mode is active.

| Mode                | Tool behavior                               | Model's visible prompt     |
| ------------------- | ------------------------------------------- | -------------------------- |
| `default`           | user-prompted (unless allow-rule matches)   | unchanged                  |
| `plan`              | read-only enforced                          | plan-mode attachment added |
| `auto`              | yolo classifier decides (~90% auto-approve) | unchanged                  |
| `acceptEdits`       | file edits auto-allowed                     | unchanged                  |
| `bypassPermissions` | all tools auto-allowed                      | unchanged                  |
| `dontAsk`           | all tools auto-allowed, no "ask" phase      | unchanged                  |

**User denial** returns the tool_result content as `feedback ?? 'User denied permission'` (`interactiveHandler.ts:189`) — the user's typed feedback or the default string. No special system-reminder.

### Plan mode

Plan mode fires an attachment every turn. Two content variants, throttled:

- **Full reminder** — turns 1, 6, 11, … (every `FULL_REMINDER_EVERY_N_ATTACHMENTS` = 5). Content: the 5-phase workflow (Understanding via parallel Explore agents → Design via Plan agents → Review → Final Plan → `ExitPlanMode`). Alternative: the interview-based iterative workflow (`isPlanModeInterviewPhaseEnabled()`), which replaces the 5 phases with an explore → update-plan → AskUserQuestion loop.

- **Sparse reminder** — turns 2-5, 7-10, 12-14, …:

  > _"Plan mode still active (see full instructions earlier in conversation). Read-only except plan file ({planFilePath}). Follow {5-phase or iterative} workflow. End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for plan approval). Never ask about plan approval via text or AskUserQuestion."_

- **Re-entry** — a distinct attachment when the user re-enters plan mode with an existing plan file, directing the model to evaluate the existing plan (start fresh / continue / modify).

- **Exit**:
  > _"## Exited Plan Mode / You have exited plan mode. You can now make edits, run tools, and take actions. [If plan exists: The plan file is located at {planFilePath} if you need to reference it.]"_

**Load-bearing rule inside plan mode**: **plan approval uses `ExitPlanMode`, clarification uses `AskUserQuestion`.** The prompt explicitly forbids asking for approval via AskUserQuestion because the user can't see the plan file through AskUserQuestion's UI.

### Auto mode

Same full-vs-sparse throttling.

**Full** (the 6-numbered-bullet directive — verbatim in `messages.ts:3428-3443`): execute immediately, minimize interruptions, prefer action over planning, expect course corrections, not destructive, no data exfiltration.

**Sparse**:

> _"Auto mode still active (see full instructions earlier in conversation). Execute autonomously, minimize interruptions, prefer action over planning."_

**Exit**: _"## Exited Auto Mode / You have exited auto mode. The user may now want to interact more directly. You should ask clarifying questions when the approach is ambiguous rather than making assumptions."_

**Pattern worth extracting** — **full-vs-sparse reminder throttling**: for persistent-mode skills that need their instructions present in every turn, use full on 1/6/11/… and a one-liner in between. The one-liner references the full by phrase (_"see full instructions earlier in conversation"_) so the model knows it's a pointer, not a standalone spec.

### Bare mode

`CLAUDE_CODE_SIMPLE=1` env var (`constants/prompts.ts:450-454`) returns only:

```
You are Claude Code, Anthropic's official CLI for Claude.

CWD: {cwd}
Date: {sessionStartDate}
```

Excludes everything else — tools, tone/style, actions-with-care, `<system-reminder>` explanation, permissions, language, MCP, hooks, cyber-risk. Useful for headless agents where the overhead isn't worth the tokens.

### Yolo classifier (auto-mode decider)

The LLM-based permission classifier (`utils/permissions/yoloClassifier.ts`). Runs in two stages:

- **Stage 1 (fast)** — max 64 tokens, stop-sequence `</block>`, suffix:

  > _"Err on the side of blocking. `<block>` immediately."_

- **Stage 2 (thinking)** — max 4096 tokens, chain-of-thought, suffix:
  > _"Review the classification process and follow it carefully, making sure you deny actions that should be blocked. As a reminder, explicit (not suggestive or implicit) user confirmation is required to override blocks. Use `<thinking>` before responding with `<block>`."_

**Output schema** (strict):

```
<block>yes</block><reason>one short sentence</reason>   (to block)
<block>no</block>                                        (to allow)
```

Explicit forbiddance:

> _"Do NOT include a `<reason>` tag when the action is allowed. Your ENTIRE response MUST begin with `<block>`. Do NOT output any analysis, reasoning, or commentary before `<block>`."_

Base prompt loaded from a bundled external file (`auto_mode_system_prompt.txt`). User-configurable rules injected via templates (`<user_allow_rules_to_replace>`, `<user_deny_rules_to_replace>`, `<user_environment_to_replace>`).

**Pattern — staged classifier**: Stage 1 rubber-stamps obvious allows; Stage 2 reasons over borderline cases with chain-of-thought. Two-stage split balances latency (most decisions resolve fast) against precision (borderline cases get budget for reasoning).

---

## 9. Context reduction (besides full compaction)

Full compaction isn't the only way the harness reduces context. Five granular micro-compression strategies run before or instead of full compaction:

| Mechanism                                   | Trigger                                                                | What it does                                                                                   | What the model sees                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **History snip**                            | `feature('HISTORY_SNIP')` + `snip` tool call or growth threshold       | Replace old segments with boundary markers                                                     | `SNIP_NUDGE_TEXT` attachment every ~10k tokens of growth                                                                                                       |
| **Context collapse**                        | `feature('CONTEXT_COLLAPSE')`; runs post-microcompact, pre-autocompact | Read-time projection archives messages into a collapse store, flows back into `state.messages` | nothing — silent projection                                                                                                                                    |
| **Function-result clearing (microcompact)** | `feature('CACHED_MICROCOMPACT')`; old tool results age out             | Tool-result content replaced with `[Old tool result content cleared]`; keeps most-recent N     | system-prompt section: _"Old tool results will be automatically cleared from context to free up space. The {keepRecent} most recent results are always kept."_ |
| **Tool-result truncation**                  | output exceeds `maxResultSizeChars` (tool-specific; 50k default)       | Persists full result to disk (`tool-results/<id>.txt`); inline wrapper with 2KB preview + path | _"Output too large (…). Full output saved to: {filepath}\n\nPreview (first 2KB): …"_                                                                           |
| **Compaction reminder**                     | `feature('COMPACTION_REMINDERS')` + usage > 25% of context             | Pre-compaction nudge                                                                           | _"Auto-compact is enabled. When the context window is nearly full, older messages will be automatically summarized so you can continue working seamlessly."_   |

### Microcompact's pairing directive

The function-result-clearing section is always paired with this instruction to the model:

> _"When working with tool results, write down any important information you might need later in your response, as the original tool result may be cleared later."_

(`constants/prompts.ts`, `SUMMARIZE_TOOL_RESULTS_SECTION`)

**Stock phrase worth reusing**: whenever your system might delete or summarize tool output post-hoc, tell the model to extract what it needs into its own reasoning _before_ the deletion happens. The model's response becomes the durable record.

### Microcompact cache-edits

Content removal is tracked as `cache_edits` blocks pinned to user-message positions, and replayed on subsequent API calls for cache revalidation. The deletion is part of the message, not a mutation of history — preserving prompt-cache identity across the reduction.

### What microcompact can clear

Only results from file ops (Read/Edit/Write), Bash, Glob/Grep, Web Search/Fetch. Other tool results (Skill invocation, Agent result) are kept in full.

---

## 10. Task-notification pipeline

When an async / background agent completes, its result becomes a synthetic user message on a later turn. Full shape (`LocalAgentTask.tsx:252-262`):

```
<task-notification>
  <task-id>{taskId}</task-id>
  <tool-use-id>{toolUseId}</tool-use-id>   (optional)
  <output-file>{path}</output-file>
  <status>{completed|failed|cancelled}</status>
  <summary>{short summary}</summary>
  <result>{result}</result>                 (optional)
  <usage>{tokens}</usage>                   (optional)
  <worktree>{...}</worktree>                (optional)
</task-notification>
```

**Flow:**

1. Async agent finishes → `enqueueAgentNotification({ mode: 'task-notification' })`.
2. `drainCommandQueue` (`print.ts:2015-2033`) dequeues.
3. Parses XML tags.
4. Emits SDK `system` event (`subtype: 'task_notification'`).
5. Injects synthetic user message with the XML payload.

### Coordinator mode framing

`coordinator/coordinatorMode.ts:111-157` — workers are **signals, not conversation partners**. The coordinator's system prompt frames task-notifications as internal state updates, not user dialogue. A scratchpad directory enables cross-worker durable state (not context compression; just durable shared memory).

### Buddy / Bridge / Remote

- **Buddy** (`buddy/`) — a companion UI sprite beside the input. Injects only a one-time `companion_intro` attachment on companion change. No context-reduction role.
- **Bridge / Remote** — Claude.ai ↔ CLI sync protocol. Remote agents see the standard system prompt. One UX tweak: status messages include _"Status: compacting"_ during a reactive compact. No unique model-facing prompts.

---

## 11. Implications for authors

### When you're building a CC-style system

1. **Composition as a function of state, not a string.** Don't hand-write the system prompt. Build it from section functions, each with a clear gate.
2. **Boundary discipline is load-bearing.** Place static content before the boundary, session-variant after. Treat boundary moves like schema migrations.
3. **Memoize aggressively.** `systemPromptSection` caches until `/clear`/`/compact`. Only use the uncached variant with an audit-trail reason.
4. **Three cache scopes, three mental models.** `global` = fleet reuse, `org` = session reuse, `null` = never cached. Wrong scope = billing surprise or cache miss.
5. **Attachments are the atomic unit of prompt change.** New in-conversation content → new attachment type. Don't synthesize raw user messages.
6. **Dedup per-type, not globally.** `sentSkillNames`, `readFileState`, delta reconstruction from prior attachments — each channel has its own idempotence story.

### When you're authoring a SKILL.md

1. **Skills with `context: fork`** get their own token budget and sub-agent isolation. Use for self-contained workflows that shouldn't steer mid-process.
2. **`addInvokedSkill` will preserve your body across compaction.** You don't need to re-inject; just make the body complete enough to self-explain after a summary.
3. **`${CLAUDE_SKILL_DIR}`** references bundled files that are extracted lazily with O_EXCL + 0o700. Safe to reference in `!`shell commands``; subject to your `allowed-tools`.
4. **`paths:` frontmatter** turns the skill into a conditional: it stays dormant until a matching file is touched. Gitignore-style matching.
5. **Frontmatter `hooks:`** registers hooks scoped to the skill's invocation. Fires during skill execution, not session-wide.

### When you're designing a sub-agent

1. **Decide fork vs fresh up front.** Fork if you want cache-sharing and context inheritance; fresh if isolation matters more than cost.
2. **`omitClaudeMd: true`** on read-only agents saves real tokens at scale.
3. **Background agents are fire-and-forget.** Don't design them expecting the caller to read progress; the caller must wait for the notification.
4. **Nested depth has no prompt-level consequence yet.** Don't build workflows that depend on depth-based behavior.

### When you're adding a new attachment type

1. **Register in `getAttachments`** with a `maybe()` wrapper so failures are local.
2. **Render in `normalizeAttachmentForAPI`** — decide: SR-wrapped, tool_result-shaped, or meta user message?
3. **Dedup in a per-type cache**, not globally. Usually a `Set<string>` or a turn-count gate.
4. **Handle --resume**: if transcript contains prior renderings, decide whether to suppress, recompute, or reconstruct-from-delta.
5. **Design for smoosh**: keep your attachment's text content SR-wrapped so the smoosh pass finds and merges it cleanly.

### When you're adding a new hook

1. **Hooks are user voice.** Output in `additionalContext` appears to the model as user feedback with `<user-prompt-submit-hook>` (or equivalent) tags. Author your hook text accordingly.
2. **`PreToolUse` can block; `PostToolUse` can only annotate.** Refusals from `PreToolUse` come back as user messages the model should adapt to — don't author them as system errors.
3. **Sync hooks return structured output. Async hooks are fire-and-forget.** Design for the right shape.

---

## Appendix: key file map

| File                                              | Role                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `constants/prompts.ts`                            | System prompt composition, section builders, boundary marker                        |
| `constants/cyberRiskInstruction.ts`               | Safety boundary (owned by Safeguards team)                                          |
| `services/api/claude.ts`                          | `buildSystemPromptBlocks`, API delivery                                             |
| `services/api/splitSysPromptPrefix` (in `api.ts`) | Cache-block splitting                                                               |
| `services/compact/prompt.ts`                      | BASE / PARTIAL / PARTIAL_UP_TO prompts + 9-section template                         |
| `services/compact/compact.ts`                     | Compaction flow orchestration                                                       |
| `services/compact/postCompactCleanup.ts`          | State reset strategy                                                                |
| `utils/attachments.ts`                            | ~40 attachment types, pipeline orchestration, per-type dedup                        |
| `utils/messages.ts`                               | `wrapInSystemReminder`, `smooshSystemReminderSiblings`, `normalizeAttachmentForAPI` |
| `utils/hooks.ts`                                  | Hook result → attachment mapping                                                    |
| `utils/conversationRecovery.ts`                   | --resume state reconstruction                                                       |
| `utils/argumentSubstitution.ts`                   | `$ARGUMENTS` / `$name` / `$0`-`$9` substitution for skills                          |
| `tools/AgentTool/runAgent.ts`                     | Sub-agent spawn flow, system prompt composition for sub-agents                      |
| `tools/AgentTool/forkSubagent.ts`                 | Fork boilerplate, byte-identity mechanism, `isInForkChild` guard                    |
| `tools/AgentTool/built-in/*.ts`                   | Fresh-agent personas                                                                |
| `tools/SkillTool/SkillTool.ts`                    | Forked skill invocation (`executeForkedSkill`)                                      |
| `bootstrap/state.ts`                              | `invokedSkills` preservation state, `queryTracking.depth`                           |
| `skills/loadSkillsDir.ts`                         | Skill frontmatter parsing, dynamic discovery, conditional activation                |
| `skills/bundledSkills.ts`                         | `registerBundledSkill`, `files:` extraction                                         |
