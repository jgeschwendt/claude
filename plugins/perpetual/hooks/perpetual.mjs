// perpetual: the harness's session hooks, guards and window clock, plus the shift band.

/** prompts that read as the person correcting the session */
const CORRECTION = [
  /^no[,.! ]/i,
  /\bdon'?t\b/i,
  /\bi said\b/i,
  /\bnever\b/i,
  /\bnot what i\b/i,
  /\bstop\b/i,
  /\bwrong\b/i,
];

/** a command word at the start of a shell command: line start, after `;`, `&`, `|`, `(`, `{` or `$(` */
const AT = String.raw`(?:^|[;&|({]|\$\()\s*`;
/** `git` and its global options, then the subcommand */
const GIT = String.raw`${AT}git(?:\s+-[Cc]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+`;
/** Bash commands the house rules forbid, each with the rule that forbids it */
const GUARDS = /** @type {[string, string][]} */ ([
  [
    String.raw`${AT}pkill\b[^;&|]*\s-[a-z]*f`,
    "pkill -f matches every process's full argv — kill by resolved PID: `lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`",
  ],
  [
    String.raw`${GIT}checkout\b[^;&|]*\s--(?:\s|$)`,
    "never mutate to inspect — `git checkout --` discards every uncommitted change to the path, co-resident work included; undo your own edit by re-editing",
  ],
  [
    String.raw`${GIT}reset\b[^;&|]*\s--hard\b`,
    "never mutate to inspect — `git reset --hard` discards the working tree; commit, or fast-forward with `git update-ref`",
  ],
  [
    String.raw`${GIT}push\b[^;&|]*\s(?:--force(?:-with-lease)?(?:=\S*)?|-f)(?=\s|$)`,
    "never force-push — push a new branch or a new commit instead",
  ],
  [
    String.raw`${GIT}stash\b(?!\s+(?:list|show)\b)`,
    "never `git stash` — the stash stack is shared across worktrees and sessions; set work aside with a WIP commit",
  ],
  [
    String.raw`${GIT}clean\b`,
    "never mutate to inspect — `git clean` deletes untracked files, co-resident work included",
  ],
]).map(([pattern, reason]) => /** @type {const} */ ([new RegExp(pattern, "m"), reason]));
/** the notification types docket opens a thread for */
const NOTIFY = ["agent_needs_input", "idle_prompt", "permission_prompt"];

const HOOK_MS = 10000;
const REFRESH_MS = 15000;
const REPEAT_JACCARD = 0.8;
const REPEAT_MIN_TOKENS = 3;
const TAKE_MS = 1500;
const TRAIL_DEFAULT_LINES = 10;

/** @type {{ home: string | undefined, last: any, prompts: Set<string>[], shift: any, timer: { cancel(): void } | undefined }} */
const state = { home: undefined, last: null, prompts: [], shift: null, timer: undefined };

/**
 * Appends one trail event; a failure is logged, never raised.
 * @param {any} $
 * @param {string} kind
 * @param {string} rationale
 */
async function append($, kind, rationale) {
  const argv = ["trail", "append", "--kind", kind, "--rationale", rationale];
  argv.push("--ref", `session:${await $.session.id()}`);
  const shift = await $.env.get("SANDMAN_SHIFT");
  if (shift) argv.push("--shift", shift);
  await run($, "sandman", argv, { timeoutMs: 5000 });
}

/**
 * Minutes until `handoff_by`, as `1h05m left`, or `handoff due` once past.
 * @param {string | undefined} handoffBy
 * @param {number} now
 */
function clockOf(handoffBy, now) {
  if (!handoffBy) return undefined;
  const due = Date.parse(handoffBy);
  if (Number.isNaN(due)) return handoffBy;
  const minutes = Math.floor((due - now) / 60000);
  if (minutes <= 0) return "handoff due";
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h${String(minutes % 60).padStart(2, "0")}m left` : `${minutes}m left`;
}

/**
 * Runs a settings-hook binary on the event's stdin JSON, as a command hook would, and resolves
 * to the context it adds: `hookSpecificOutput.additionalContext` of a JSON reply, or plain stdout.
 * @param {any} $
 * @param {string} bin
 * @param {string[]} args
 * @param {object} e
 * @param {number} timeoutMs
 * @returns {Promise<string[]>}
 */
async function hook($, bin, args, e, timeoutMs = HOOK_MS) {
  const out = (await run($, bin, args, { stdin: JSON.stringify(e), timeoutMs }))?.trim();
  if (!out) return [];
  if (!/^\{[^]*\}$/.test(out)) return [out];
  const context = parse(out)?.hookSpecificOutput?.additionalContext;
  return typeof context === "string" && context ? [context] : [];
}

/** @param {any} $ */
async function homeOf($) {
  state.home ??= (await $.env.get("HOME")) ?? "";
  return state.home;
}

/**
 * Jaccard similarity of two token sets.
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
function jaccard(a, b) {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** @param {string | undefined} text */
function parse(text) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reads a file's text, or `undefined` when it is missing or unreadable.
 * @param {any} $
 * @param {string} path
 */
async function readText($, path) {
  try {
    return await $.fs.read(path);
  } catch {
    return undefined;
  }
}

/**
 * Re-reads the shift file and today's trail tail, then asks for a redraw.
 * @param {any} $
 */
async function refresh($) {
  const home = await homeOf($);
  const day = new Date(await $.clock.now()).toISOString().slice(0, 10).split("-");
  const shiftText = await readText($, `${home}/.sandman/shifts/current.json`);
  const trailText = await readText($, `${home}/.sandman/trail/${day[0]}/${day[1]}/${day[2]}.jsonl`);
  state.shift = parse(shiftText);
  state.last = parse(trailText?.trimEnd().split("\n").at(-1));
  $.ui.invalidate("ui.render");
}

/**
 * Runs `~/.local/bin/<bin>`; resolves to its stdout, or `undefined` after a dim log line when it
 * cannot start, times out or exits non-zero. Never raises: no binary may break a session.
 * @param {any} $
 * @param {string} bin
 * @param {string[]} args
 * @param {object} [init]
 */
async function run($, bin, args, init) {
  const name = [bin, ...args.slice(0, 2)].join(" ");
  try {
    const { exitCode, stderr, stdout } = await $.process.run(
      [`${await homeOf($)}/.local/bin/${bin}`, ...args],
      init,
    );
    if (exitCode === 0) return stdout;
    $.ui.log(`perpetual: ${name} exited ${exitCode}: ${stderr.trim().split("\n")[0]}`);
  } catch (error) {
    $.ui.log(`perpetual: ${name} failed: ${error}`);
  }
  return undefined;
}

/**
 * Runs a binary for a command and logs what it printed.
 * @param {any} $
 * @param {string} bin
 * @param {string[]} args
 * @param {(stdout: string) => string} shape
 */
async function show($, bin, args, shape = (stdout) => stdout.trim()) {
  const stdout = await run($, bin, args);
  if (stdout !== undefined) $.ui.log(shape(stdout) || "(empty)");
  return {};
}

/** @param {string} text */
function tokensOf(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/**
 * Persists the five-hour window to `$CLAUDE_WINDOW_FILE`, else `$XDG_STATE_HOME/claude/window.json`,
 * else `~/.local/state/claude/window.json`, for `sandman shift clock`: written to a per-session `.tmp`
 * then renamed with `mv`, since `$.fs.write` is not atomic. Skipped without both figures.
 * @param {any} $
 */
async function window($) {
  const five = (await $.session.usage()).rateLimits.find((/** @type {{ kind: string }} */ limit) => limit.kind === "five_hour");
  const resetsAt = Date.parse(five?.resetsAt ?? "");
  if (Number.isNaN(resetsAt) || typeof five.percentUsed !== "number") return;
  const root = (await $.env.get("XDG_STATE_HOME")) || `${await homeOf($)}/.local/state`;
  const path = (await $.env.get("CLAUDE_WINDOW_FILE")) || `${root}/claude/window.json`;
  const id = await $.session.id();
  const at = new Date(await $.clock.now()).toISOString().replace(/\.\d+Z$/, "Z");
  const five_hour = { resets_at: Math.floor(resetsAt / 1000), used_percentage: five.percentUsed };
  try {
    await $.fs.write(`${path}.${id}.tmp`, JSON.stringify({ at, five_hour, session_id: id }));
    await $.process.run(["/bin/mv", "-f", `${path}.${id}.tmp`, path]);
  } catch (error) {
    $.ui.log(`perpetual: window.json write failed: ${error}`);
  }
}

/**
 * Runs side-effect hooks beside the chain beneath and returns its result untouched.
 * @param {any} next
 * @param {any} e
 * @param {Promise<unknown>[]} runs
 */
async function beside(next, e, runs) {
  return (await Promise.all([next(e), ...runs]))[0];
}

/**
 * Runs context hooks beside the chain beneath and adds what they print, in order.
 * @param {any} next
 * @param {any} e
 * @param {Promise<string[]>[]} runs
 */
async function context(next, e, runs) {
  const [result, ...contexts] = await Promise.all([next(e), ...runs]);
  const additionalContext = [...(result.additionalContext ?? []), ...contexts.flat()];
  return additionalContext.length ? { ...result, additionalContext } : result;
}

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on("agent.spawn", ($, e, next) => next(e.model || e.fork ? e : { ...e, model: "opus" }));

  on("classic.Notification", { notification_type: NOTIFY }, ($, e, next) =>
    beside(next, e, [hook($, "docket", ["--hook"], e)]),
  );

  on("classic.SessionEnd", ($, e, next) =>
    beside(next, e, [hook($, "sandman", ["take", "--hook"], e, TAKE_MS)]),
  );

  on("classic.SessionStart", ($, e, next) =>
    context(next, e, [
      hook($, "sandman", ["recall", "--hook"], e),
      hook($, "docket", ["--hook"], e),
      hook($, "sandman", ["report", "--hook"], e),
    ]),
  );

  on("classic.Stop", ($, e, next) => beside(next, e, [hook($, "docket", ["--hook"], e)]));

  on("classic.UserPromptSubmit", ($, e, next) => context(next, e, [hook($, "docket", ["--hook"], e)]));

  on("command.run", { command: "docket" }, ($) => show($, "docket", ["list"]));

  on("command.run", { command: "shift" }, ($) => show($, "sandman", ["shift", "status"]));

  on("command.run", { command: "trail" }, ($, e) => {
    const n = Number.parseInt(e.args.trim(), 10);
    const count = Number.isInteger(n) && n > 0 ? n : TRAIL_DEFAULT_LINES;
    return show($, "sandman", ["trail", "log"], (stdout) =>
      stdout.trimEnd().split("\n").slice(-count).join("\n"),
    );
  });

  on("prompt.submit", async ($, e, next) => {
    // the owner's live words only: a `claude -p` shift brief's "never …" is no correction
    if (e.origin.kind !== "composer") return next(e);
    const tokens = tokensOf(e.text);
    const isRepeat =
      tokens.size >= REPEAT_MIN_TOKENS &&
      state.prompts.some((seen) => jaccard(seen, tokens) >= REPEAT_JACCARD);
    state.prompts.push(tokens);
    const head = e.text.slice(0, 200);
    if (isRepeat) await append($, "correction", `repeated instruction: ${head}`);
    else if (CORRECTION.some((pattern) => pattern.test(e.text))) await append($, "correction", head);
    return next(e);
  }).catch(($, e, next) => next(e)); // observe-only: a failed capture never holds the prompt

  on("session.measure", async ($, e, next) => (await window($), next(e)));

  on("session.start", async ($, e, next) => {
    for (const [name, description, argumentHint] of /** @type {[string, string, string?][]} */ ([
      ["docket", "Lists the docket's threads (log only)."],
      ["shift", "Shows the current sandman shift (log only)."],
      ["trail", "Shows the last n trail events, 10 by default (log only).", "[n]"],
    ]))
      await $.command.register({ argumentHint, description, immediate: true, name });
    await window($);
    if (e.isInteractive && e.surface !== null) {
      await refresh($);
      state.timer?.cancel();
      state.timer = $.clock.every(REFRESH_MS, () => refresh($));
    }
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const reason = GUARDS.find(([pattern]) => pattern.test(e.command))?.[1];
    if (!reason) return next(e);
    await append($, "guard", `${reason}: ${e.command.slice(0, 200)}`);
    return { deny: `perpetual: ${reason}.` };
  });

  on("tool.call", { tool: ["Edit", "Write"] }, async ($, e, next) => {
    if (!/\.yml$/i.test(e.file_path)) return next(e);
    const reason = "YAML files end in `.yaml`, never `.yml` — rename on touch";
    await append($, "guard", `${reason}: ${e.file_path}`);
    return { deny: `perpetual: ${reason}.` };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { last, shift } = state;
    if (e.props.hasSurvey || (!shift && !last)) return next(e);
    const parts = [
      shift?.shift,
      shift?.theme,
      shift?.repo,
      clockOf(shift?.handoff_by, await $.clock.now()),
      last ? `last: ${[last.kind, last.rationale].filter(Boolean).join(" ")}` : undefined,
    ].filter(Boolean);
    const width = Math.max(1, e.props.bodyColumns);
    let line = `⟳ ${parts.join(" · ")}`.replace(/\s+/g, " ");
    if (line.length > width) line = `${line.slice(0, width - 1)}…`;
    const { Text } = $.ui.resolve(e);
    return h(Text, { dimColor: true, wrap: "truncate-end" }, line);
  });
};
