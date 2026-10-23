// perpetual: the harness's session hooks, guards and window clock, plus the shift band.

/** prompts that read as the person correcting the session */
const CORRECTION = /^no[,.! ]|\bdon'?t\b|\bi said\b|\bnever\b|\bnot what i\b|\bstop\b|\bwrong\b/i;

/** an optional quote, backslash or directory before a command word: `"git"`, `\git`, `/usr/bin/git` */
const W = String.raw`[\\'"]?(?:[\w./~-]*\/)?`;
/** a statement keyword or a wrapper that runs the command after it, shells (`bash -c`) and `eval` included */
const PRE = String.raw`(?:if|elif|while|until|then|do|else|!|${W}(?:sudo|env|command|exec|eval|nice|nohup|time|timeout|xargs|mise\s+(?:x|exec)|(?:ba|da|k|z)?sh))(?=\s)`;
/**
 * a command word at a command position: line start, or after `;`, `&`, `|`, `(`, `{` or a backtick, then any
 * `VAR=value` or PRE, a PRE taking options (`--`, `-u me`: a value is never a PRE, a `VAR=`, nor
 * leads with `-` or a digit, so each word parses one way) and bare numbers (`timeout 5`)
 */
const AT = String.raw`(?:^|[;&|({\`])\s*(?:${PRE}(?:\s+(?:-\S+(?:\s+(?!${PRE}|\w+=)[^-\d\s]\S*)?|\d\S*))*\s+|\w+=\S*\s+)*${W}`;
/** the rest of one command: up to a separator or the end of the line */
const ARGS = String.raw`[^;&|\n]*`;
/**
 * `git`, closing quote and all, and its global options, then the subcommand: `-C <path>`, quoted or not, `-c k=v`, a lone letter (`-P`), a
 * value-taking long option with `=` or a separate value (`--git-dir <dir>`), any other long option with `=` only — a
 * separate value for every `--opt` would read `git --no-pager show stash@{0}` as `stash`, and backtrack exponentially
 */
const GIT = String.raw`${AT}git['"]?(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|\s+-[abd-zABD-Z]\b|\s+--(?:git-dir|work-tree|namespace|super-prefix|config-env)(?:=|\s+(?!-))\S+|\s+--[\w-]+(?:=\S+)?)*\s+`;
/** Bash commands the house rules forbid, each with the rule that forbids it */
const GUARDS = [
  [
    String.raw`${AT}pkill\b['"]?${ARGS}\s(?:-[a-z]*f|--full\b)`,
    "pkill -f matches every process's full argv — kill by resolved PID: `lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`",
  ],
  [
    String.raw`${GIT}checkout\b${ARGS}\s--(?=[\s'";&|)]|$)`,
    "never mutate to inspect — `git checkout --` discards every uncommitted change to the path, co-resident work included; undo your own edit by re-editing",
  ],
  [
    String.raw`${GIT}reset\b${ARGS}\s--ha(?:rd?)?\b`,
    "never mutate to inspect — `git reset --hard` discards the working tree; commit, or fast-forward with `git update-ref`",
  ],
  [
    String.raw`${GIT}push\b${ARGS}\s(?:--forc(?:e(?:-w[\w-]*)?)?(?:=\S*)?|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)(?=[\s'";&|)]|$)`,
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
].map(([pattern, reason]) => [new RegExp(pattern, "m"), reason]);
const HOOK_MS = 10000;
const TAKE_MS = 1500;

const state = { prompts: [] };

/** Appends one trail event; a failure is logged, never raised. */
async function append($, kind, rationale) {
  const argv = ["trail", "append", "--kind", kind, "--rationale", rationale];
  argv.push("--ref", `session:${await $.session.id()}`);
  const shift = await $.env.get("SANDMAN_SHIFT");
  if (shift) argv.push("--shift", shift);
  await run($, "sandman", argv, { timeoutMs: 5000 });
}

/** Minutes until `handoff_by`, as `1h05m left` or `handoff due` once past; unparseable, itself. */
function clockOf(handoffBy, now) {
  if (!handoffBy) return undefined;
  const due = Date.parse(handoffBy);
  if (Number.isNaN(due)) return handoffBy;
  if (due <= now) return "handoff due";
  const minutes = Math.ceil((due - now) / 60000);
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h${String(minutes % 60).padStart(2, "0")}m left` : `${minutes}m left`;
}

/**
 * Runs a settings-hook binary on the event's stdin JSON, as a command hook would, and resolves
 * to the context it adds: `hookSpecificOutput.additionalContext` of a JSON reply, or plain stdout.
 */
async function hook($, bin, args, e, timeoutMs = HOOK_MS) {
  const out = (await run($, bin, args, { stdin: JSON.stringify(e), timeoutMs }))?.trim();
  const context = /^\{[^]*\}$/.test(out) ? parse(out)?.hookSpecificOutput?.additionalContext : out;
  return typeof context === "string" && context ? [context] : [];
}

const homeOf = async ($) => (state.home ??= (await $.env.get("HOME")) ?? "");

function parse(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Re-reads the shift file and today's trail tail, then asks for a redraw. */
async function refresh($) {
  const home = await homeOf($);
  const day = new Date(await $.clock.now()).toISOString().slice(0, 10).replaceAll("-", "/");
  const shiftText = await $.fs.read(`${home}/.sandman/shifts/current.json`).catch(() => "");
  const trailText = await $.fs.read(`${home}/.sandman/trail/${day}.jsonl`).catch(() => "");
  state.shift = parse(shiftText);
  state.last = parse(trailText.trimEnd().split("\n").at(-1));
  $.ui.invalidate("ui.render");
}

/**
 * Runs `~/.local/bin/<bin>`; resolves to its stdout, or `undefined` after a dim log line when it
 * cannot start, times out or exits non-zero. Never raises: no binary may break a session.
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
}

/** Runs a binary for a command and logs what it printed. */
async function show($, bin, args, shape = (stdout) => stdout.trim()) {
  const stdout = await run($, bin, args);
  if (stdout !== undefined) $.ui.log(shape(stdout) || "(empty)");
  return {};
}

/**
 * Resolves the open notification `problem` threads (every message the title: docket's Notification) keyed
 * `session:<id>` of sessions absent from Claude Code's live registry, `~/.claude/sessions/<pid>.json`
 * (`sessionId`): a killed session fires no SessionEnd. Headless `-p` sessions never register, so a thread
 * docket's Stop opened for one (a `failed:` message) is left alone. Skipped unless the registry reads and
 * lists this session — else its format changed and absence is no evidence. The list, then the resolves,
 * get 5 s each, so with the registry reads the sweep can hold SessionStart ≈10 s; it adds no context.
 */
async function sweep($) {
  const dir = `${await homeOf($)}/.claude/sessions`;
  const live = new Set();
  for (const { name } of await $.fs.list(dir).catch(() => []))
    if (name.endsWith(".json"))
      live.add(parse(await $.fs.read(`${dir}/${name}`).catch(() => ""))?.sessionId);
  if (!live.has(await $.session.id())) return [];
  const init = { timeoutMs: HOOK_MS / 2 };
  const threads = parse(await run($, "docket", ["list", "--json"], init));
  await Promise.all(
    (Array.isArray(threads) ? threads : [])
      .filter(
        (thread) =>
          thread.kind === "problem" &&
          thread.key?.startsWith("session:") &&
          !live.has(thread.key.slice(8)) &&
          thread.messages.every((message) => message.body === thread.title),
      )
      .map((thread) => run($, "docket", ["resolve", thread.id, "--reason", "session gone"], init)),
  );
  return [];
}

/**
 * Persists the five-hour window to `$CLAUDE_WINDOW_FILE`, else `$XDG_STATE_HOME/claude/window.json`,
 * else `~/.local/state/claude/window.json`, for `sandman shift clock`: written to a per-session `.tmp`
 * then renamed with `mv`, since `$.fs.write` is not atomic. Skipped without both figures.
 */
async function window($) {
  const five = (await $.session.usage()).rateLimits.find((limit) => limit.kind === "five_hour");
  const resetsAt = Date.parse(five?.resetsAt);
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

/** Runs side-effect hooks beside the chain beneath and returns its result untouched. */
async function beside(next, e, runs) {
  return (await Promise.all([next(e), ...runs]))[0];
}

/** Runs context hooks beside the chain beneath and adds what they print, in order. */
async function context(next, e, runs) {
  const [result, ...contexts] = await Promise.all([next(e), ...runs]);
  const additionalContext = [...(result.additionalContext ?? []), ...contexts.flat()];
  return additionalContext.length ? { ...result, additionalContext } : result;
}

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on("agent.spawn", ($, e, next) => next(e.model || e.fork ? e : { ...e, model: "opus" }));

  // the notification types docket opens a thread for
  on(
    "classic.Notification",
    { notification_type: ["agent_needs_input", "idle_prompt", "permission_prompt"] },
    ($, e, next) => beside(next, e, [hook($, "docket", ["--hook"], e)]),
  );

  // an ended session waits on no one: its idle or permission notification fired after the last Stop,
  // so docket's Stop never resolved it, and docket's hook has no SessionEnd
  on("classic.SessionEnd", ($, e, next) => {
    const key = `session:${e.session_id}`;
    return beside(next, e, [
      hook($, "sandman", ["take", "--hook"], e, TAKE_MS),
      run($, "docket", ["resolve", "--key", key, "--reason", "session ended"], {
        timeoutMs: TAKE_MS,
      }),
    ]);
  });

  on("classic.SessionStart", ($, e, next) =>
    context(next, e, [
      hook($, "sandman", ["recall", "--hook"], e),
      hook($, "docket", ["--hook"], e),
      hook($, "sandman", ["report", "--hook"], e),
      sweep($),
    ]),
  );

  on("classic.Stop", ($, e, next) => beside(next, e, [hook($, "docket", ["--hook"], e)]));

  on("classic.UserPromptSubmit", ($, e, next) =>
    context(next, e, [hook($, "docket", ["--hook"], e)]),
  );

  on("command.run", { command: "docket" }, ($) => show($, "docket", ["list"]));

  on("command.run", { command: "shift" }, ($) => show($, "sandman", ["shift", "status"]));

  on("command.run", { command: "trail" }, ($, e) => {
    const n = Number.parseInt(e.args, 10);
    const count = n > 0 ? n : 10;
    return show($, "sandman", ["trail", "log"], (stdout) =>
      stdout.trimEnd().split("\n").slice(-count).join("\n"),
    );
  });

  on("prompt.submit", async ($, e, next) => {
    // the owner's live words only: a `claude -p` shift brief's "never …" is no correction, nor is a long or `# `
    // prompt (a brief, a pasted document), nor a `claude --bg` session's opening prompt — dispatch's brief, which
    // arrives as a composer prompt of an interactive terminal session; only the daemon's env tells it apart
    if (e.origin.kind !== "composer") return next(e);
    const isOpening = !state.isOpened;
    state.isOpened = true;
    if (e.text.length > 400 || e.text.startsWith("# ")) return next(e);
    if (isOpening && (await $.env.get("CLAUDE_CODE_SESSION_KIND")) === "bg") return next(e);
    const tokens = new Set(e.text.toLowerCase().match(/[\p{L}\p{N}']+/gu));
    // a repeat: three or more tokens, Jaccard ≥ 0.8 with an earlier prompt
    const isRepeat =
      tokens.size >= 3 &&
      state.prompts.some((seen) => {
        const shared = [...seen].filter((token) => tokens.has(token)).length;
        return shared / (seen.size + tokens.size - shared) >= 0.8;
      });
    state.prompts.push(tokens);
    const head = e.text.slice(0, 200);
    if (isRepeat) await append($, "correction", `repeated instruction: ${head}`);
    else if (CORRECTION.test(e.text)) await append($, "correction", head);
    return next(e);
  }).catch(($, e, next) => next(e)); // observe-only: a failed capture never holds the prompt

  on("session.measure", async ($, e, next) => (await window($), next(e)));

  on("session.start", async ($, e, next) => {
    for (const [name, description, argumentHint] of [
      ["docket", "Lists the docket's threads (log only)."],
      ["shift", "Shows the current sandman shift (log only)."],
      ["trail", "Shows the last n trail events, 10 by default (log only).", "[n]"],
    ])
      await $.command.register({ argumentHint, description, immediate: true, name });
    await window($);
    if (e.isInteractive) {
      await refresh($);
      state.timer?.cancel();
      state.timer = $.clock.every(15000, () => refresh($));
    }
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const command = e.command.replace(/\\\r?\n/g, " ");
    const reason = GUARDS.find(([pattern]) => pattern.test(command))?.[1];
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
      last && `last: ${[last.kind, last.rationale].filter(Boolean).join(" ")}`,
    ].filter(Boolean);
    const width = Math.max(1, e.props.bodyColumns);
    let line = `⟳ ${parts.join(" · ")}`.replace(/\s+/g, " ");
    if (line.length > width) line = `${line.slice(0, width - 1)}…`;
    const { Text } = $.ui.resolve(e);
    return h(Text, { dimColor: true, wrap: "truncate-end" }, line);
  });
};
