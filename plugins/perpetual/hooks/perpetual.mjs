// perpetual: the harness's session hooks, guards and window clock, plus the shift band.

/** prompts that read as the person correcting the session */
const CORRECTION =
  /^no(?:[,.!\s]|$)|\bdon'?t\b|\bi said\b|\bnever\b|\bnot what i\b|\bstop\b|\bwrong\b/i;

/** an optional quote, backslash or directory before a command word: `"git"`, `\git`, `/usr/bin/git` */
const W = String.raw`[\\'"]?(?:[\w./~-]*\/)?`;
/**
 * one piece of a word: a quoted string, a backtick, `(…)` or `{…}` group (`$(pwd)`, `${HOME}`, `{}`), or a character
 * no command position follows — each piece parses one way, and none runs past a separator unquoted, so a long
 * spaceless line (minified JS, a query string) is scanned once, not once per `;`
 */
const V = String.raw`(?:"[^"]*"|'[^']*'|\`[^\`]*\`|\([^()]*\)|\{[^{}]*\}|[^\s;&|(){}\`"'])`;
/** a statement keyword or a wrapper that runs the command after it, shells (`bash -c`) and `eval` included */
const PRE = String.raw`(?:if|elif|while|until|then|do|else|!|${W}(?:builtin|command|doas|env|eval|exec|mise\s+(?:x|exec)|nice|nohup|(?:ba|da|k|z)?sh|sudo|time|timeout|xargs))(?=\s)`;
/** a `tool@version` word (`mise x node@22 --`): never a value, so it parses one way */
const TOOL = String.raw`(?![-\d])[\w./:+-]+@${V}*`;
/**
 * a command word at a command position: line start, after `;`, `&`, `|`, `(` or `{`, or after an
 * `-exec`/`-execdir`/`-ok`/`-okdir` word (`find`'s; any command's counts), then any `VAR=value` or PRE, a PRE taking options (`--`, `-u me`: a
 * value is never a PRE, a `VAR=`, a TOOL, nor leads with `-` or a digit, and `--` takes none, so each word parses one way;
 * an option is never `-exec`, so each run of options ends at the next one, which starts its own),
 * TOOLs and bare numbers (`timeout 5`)
 */
const AT = String.raw`(?:^|[;&|({]|\s-(?:exec|ok)(?:dir)?(?=\s))\s*(?:${PRE}(?:[^\S\n]+(?:-(?!(?:exec|ok)(?:dir)?\s)(?:-(?=\s)|(?!-\s)${V}+(?:[^\S\n]+(?![-\d]|${PRE}|${TOOL}|\w+=)${V}+)?)|${TOOL}|\d${V}*))*[^\S\n]+|\w+=${V}*[^\S\n]+)*${W}`;
/** the rest of one command: up to a separator or the end of the line */
const ARGS = String.raw`[^;&|\n]*`;
/**
 * `git`, closing quote and all, and its global options, then the subcommand's opening quote (`git "stash"`): `-C <path>`, quoted or not, `-c k=v`, a lone letter (`-P`), any
 * long option with `=` only, a value-taking one also with a separate value (`--git-dir <dir>`) — a
 * separate value for every `--opt` would read `git --no-pager show stash@{0}` as `stash`, and backtrack exponentially
 */
const GIT = String.raw`git['"]?(?:\s+-[Cc]\s+${V}+|\s+-[abd-zABD-Z]\b|\s+--(?:git-dir|work-tree|namespace|super-prefix|config-env)\s+(?!-)${V}+|\s+--[\w-]+(?:=${V}+)?)*\s+['"]?`;
/** Bash commands the house rules forbid, each after a command position, with the rule that forbids it */
const GUARDS = [
  [
    String.raw`pkill\b['"]?${ARGS}\s(?:-[a-z]*f|--full\b)`,
    "pkill -f matches every process's full argv — kill by resolved PID: `lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`",
  ],
  [
    // a `-c`/`--config-env` alias or include (any case: git lowercases the section) is denied outright, since it can name any of these
    String.raw`${GIT}(?:(?:-c\s+|--config-env[=\s]\s*)['"]?(?:[Aa][Ll][Ii][Aa][Ss]|[Ii][Nn][Cc][Ll][Uu][Dd][Ee](?:[Ii][Ff])?)\.|checkout\b${ARGS}\s(?:(?:--(?:f\w*)?|\.)(?=[\s'";&|)]|$)|['"]?--pathspec-fr|-[dlmpqt]*f)|switch\b${ARGS}\s(?:--(?:di[\w-]*|force(?![\w-]))|-[dmqt]*f)|restore(?![\w-])(?!\s+(?:-h|--help)\b)(?:${ARGS}\s(?:--w\w*|-[mpqS]*W)|(?!${ARGS}\s(?:--st\w*|-[mpqW]*S)))|read-tree(?![\w-])${ARGS}\s(?:--res|-[imnqv]*u))`,
    "never mutate to inspect — `git checkout --`/`.`/`-f`/`--pathspec-from-file`, `git switch -f`, a worktree `git restore`, `git read-tree -u`/`--reset` and a `git -c alias.…` that can hide any of them discard every uncommitted change to the path, co-resident work included; undo your own edit by re-editing",
  ],
  [
    String.raw`${GIT}reset\b${ARGS}\s--ha(?:rd?)?\b`,
    "never mutate to inspect — `git reset --hard` discards the working tree; commit, or fast-forward with `git update-ref`",
  ],
  [
    String.raw`${GIT}push\b${ARGS}\s['"]?(?:--forc(?:e(?:-w[\w-]*)?)?(?:=\S*)?|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)(?=[\s'";&|)]|$)`,
    "never force-push — push a new branch or a new commit instead",
  ],
  [
    String.raw`${GIT}stash\b(?!['"]?\s+(?:list|show|-h|--help)\b)`,
    "never `git stash` — the stash stack is shared across worktrees and sessions; set work aside with a WIP commit",
  ],
  [
    String.raw`${GIT}clean\b(?!${ARGS}\s(?:-[dfiqxX]*n|--d))`,
    "never mutate to inspect — `git clean` deletes untracked files, co-resident work included",
  ],
];
/** every guard in one pass, so a long command is walked once, not once per guard; the capture names the guard */
const GUARD = new RegExp(`${AT}(?:${GUARDS.map(([pattern]) => `(${pattern})`).join("|")})`, "m");
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
 * Resolves the open notification `problem` threads (docket's Notification: the title the first message's first line,
 * trimmed and cut at 120 chars,
 * no message line a Stop's `failed:` or `needs input:` — later notifications append) keyed `session:<id>` where
 * `ends(id)`, by id: docket's Stop keys a `failed:` problem (its body the whole message)
 * and a `needs input:` decision under the same key, and those stay for the owner. The list, then the
 * resolves, get `timeoutMs` each.
 */
async function close($, ends, reason, timeoutMs) {
  const init = { timeoutMs };
  const threads = parse(await run($, "docket", ["list", "--json"], init));
  await Promise.all(
    (Array.isArray(threads) ? threads : [])
      .filter(
        (thread) =>
          thread.kind === "problem" &&
          thread.key?.startsWith("session:") &&
          ends(thread.key.slice(8)) &&
          [...(thread.messages[0]?.body ?? "").split("\n")[0].trim()]
            .slice(0, 120)
            .join("")
            .trimEnd() === thread.title &&
          !thread.messages.some((message) =>
            /^[\s\u0085]*(failed|needs input):/m.test(message.body),
          ),
      )
      .map((thread) => run($, "docket", ["resolve", thread.id, "--reason", reason], init)),
  );
}

/**
 * Closes the notification threads of sessions absent from Claude Code's live registry,
 * `~/.claude/sessions/<pid>.json` (`sessionId`): a killed session fires no SessionEnd. Skipped unless the
 * registry reads and lists this session — else its format changed and absence is no evidence. With the
 * registry reads the sweep can hold SessionStart ≈10 s; it adds no context.
 */
async function sweep($) {
  const dir = `${await homeOf($)}/.claude/sessions`;
  const live = new Set();
  for (const { name } of await $.fs.list(dir).catch(() => []))
    if (name.endsWith(".json"))
      live.add(parse(await $.fs.read(`${dir}/${name}`).catch(() => ""))?.sessionId);
  if (live.has(await $.session.id()))
    await close($, (id) => !live.has(id), "session gone", HOOK_MS / 2);
  return [];
}

/**
 * Hands the five-hour window to `statusline --window`, the one writer of `window.json` (its rule, its
 * directory lock), as a statusline payload. `model` rides along so a statusline built before `--window`
 * still parses it, persisting and rendering to a discarded stdout; a refusal is `run`'s log line.
 */
async function window($) {
  const five = (await $.session.usage()).rateLimits.find((limit) => limit.kind === "five_hour");
  if (!five) return;
  const five_hour = {
    resets_at: Date.parse(five.resetsAt) / 1000,
    used_percentage: five.percentUsed,
  };
  const payload = {
    model: { display_name: "" },
    rate_limits: { five_hour },
    session_id: await $.session.id(),
  };
  await run($, "statusline", ["--window"], { stdin: JSON.stringify(payload), timeoutMs: 5000 });
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
  // so docket's Stop never resolved it, and docket's hook has no SessionEnd; a `failed:` or `needs input:`
  // thread under the same key still waits on the owner. The list and resolve split the 1.5 s budget
  on("classic.SessionEnd", ($, e, next) =>
    beside(next, e, [
      hook($, "sandman", ["take", "--hook"], e, TAKE_MS),
      close($, (id) => id === e.session_id, "session ended", TAKE_MS / 2),
    ]),
  );

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
    const reason = GUARDS[GUARD.exec(command)?.slice(1).findIndex(Boolean)]?.[1];
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
