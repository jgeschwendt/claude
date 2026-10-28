// perpetual: the harness's session hooks, guards and window clock, plus the shift band.

/** prompts that read as the person correcting the session */
const CORRECTION =
  /^no(?:[,.!\s]|$)|\bdon'?t\b|\bi said\b|\bnever\b|\bnot what i\b|\bstop\b|\bwrong\b/i;

/** Bash commands the house rules forbid, by guard, each with the rule that forbids it */
const DENY = {
  checkout:
    "never mutate to inspect — `git checkout --`/`.`/`-f`/`<rev> <path>`/`--ours`/`--pathspec-from-file`, `git switch -f`, a worktree `git restore`, `git read-tree -u`/`--reset` and a `git -c alias.…` that can hide any of them discard every uncommitted change to the path, co-resident work included; undo your own edit by re-editing",
  deep: "the guard cannot read a command nested this deep — split it into plain commands",
  clean: "never mutate to inspect — `git clean` deletes untracked files, co-resident work included",
  force: "never force-push — push a new branch or a new commit instead",
  pkill:
    "pkill -f matches every process's full argv — kill by resolved PID: `lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`",
  reset:
    "never mutate to inspect — `git reset --hard` discards the working tree; commit, or fast-forward with `git update-ref`",
  stash:
    "never `git stash` — the stash stack is shared across worktrees and sessions; set work aside with a WIP commit",
};
/** words that only open a statement; `function` also takes the name after it */
const KEYWORDS = new Set([
  "!",
  "coproc",
  "do",
  "elif",
  "else",
  "function",
  "if",
  "then",
  "until",
  "while",
  "{",
  "}",
]);
/** long options of a wrapper that take a separate value */
const LONG = [
  "--adjustment",
  "--cd",
  "--chdir",
  "--close-from",
  "--env",
  "--group",
  "--host",
  "--jobs",
  "--kill-after",
  "--prompt",
  "--role",
  "--signal",
  "--type",
  "--user",
];
/** how deep a command string may nest in another (`sh -c`, `eval`, `find -exec`, heredoc, `${…}`) or a group in a line */
const NEST = 16;
/** a wrapper's positional words before the command it runs (`timeout 5`, `script -q <file>`) */
const LEADS = { gtimeout: 1, script: 1, timeout: 1 };
/** commands that run the argv after their options, each with its short options that take a value */
const WRAPPERS = {
  builtin: "",
  caffeinate: "tw",
  command: "",
  doas: "Cu",
  gtimeout: "ks",
  env: "CLPSUu",
  exec: "a",
  nice: "n",
  nocorrect: "",
  noglob: "",
  nohup: "",
  parallel: "j",
  script: "Ft",
  stdbuf: "eio",
  sudo: "CDghpRrTtUu",
  time: "fo",
  timeout: "ks",
  watch: "n",
  xargs: "adEIJLnPRSs",
  xcrun: "",
};

/**
 * Splits a Bash command line into the argv of every simple command it runs, each word after quote removal:
 * a `$(…)`, backtick or `<(…)` group is a command of its own (its word keeps a NUL in its place), a
 * redirection and its target drop out, a heredoc's body is skipped (an unquoted one's groups still run),
 * a `#` comment ends the line. `body` reads `src` as an unquoted heredoc's body. One pass, no
 * backtracking; an unclosed quote or group runs to the end.
 */
function commands(src, body = false) {
  const out = [];
  const frames = []; // the commands enclosing each open group
  const heredocs = []; // [delimiter, quoted, strip tabs], read at the next newline
  let argv = [];
  let ender = ""; // what ends the innermost group: `)`, a backtick, or nothing at the top
  let parens = 0; // subshells open inside the innermost `$(…)`
  let cases = 0; // `case` statements open there, whose patterns end in `)`
  let lead = true; // every word of the current command so far is a keyword
  let dq = body; // inside `"…"`
  let quoted = false; // the current word has a quoted part
  let target = 0; // the next word is a redirection's target (1) or `<<`'s delimiter (2, `<<-`: 3)
  let word; // undefined between words
  const to = (j) => (j < 0 ? src.length : j);
  const add = (text) => (word = (word ?? "") + text);
  const end = () => {
    if (word === undefined) return;
    if (target > 1) heredocs.push([word, quoted, target === 3]);
    else if (!target) {
      if (lead) cases += word === "case" ? 1 : word === "esac" ? -1 : 0;
      lead &&= KEYWORDS.has(word);
      argv.push(word);
    }
    target = 0;
    quoted = false;
    word = undefined;
  };
  const flush = () => {
    end();
    if (argv.length) out.push(argv);
    argv = [];
    lead = true;
  };
  const open = (by) => {
    if (frames.length > 4 * NEST) throw new RangeError("nested too deep");
    frames.push([argv, word ?? "", ender, dq, quoted, target, parens, cases, lead]);
    [argv, word, ender, dq, quoted, target, parens, cases, lead] = [
      [],
      undefined,
      by,
      false,
      false,
      0,
      0,
      0,
      true,
    ];
  };
  const shut = () => {
    flush();
    [argv, word, ender, dq, quoted, target, parens, cases, lead] = frames.pop();
    word += "\0";
  };
  /** the index of the `}` or `)` closing the group opened at `i`, or the end; only `${` nests a brace */
  const match = (i, l, r) => {
    for (let depth = 0; i < src.length; i++)
      if (src[i] === "\\") i++;
      else if (src[i] === l && (l === "(" || src[i - 1] === "$")) depth++;
      else if (src[i] === r && !--depth) return i;
    return src.length;
  };
  /** whether the `((` at `i` is arithmetic: it closes with `))`, or never closes */
  const arithmetic = (i) => {
    const j = match(i, "(", ")");
    return j === src.length || src[j - 1] === ")";
  };
  /** reads `src[from, to)` as text whose groups still run (`${…}`, an array literal) */
  const text = (from, to) => out.push(...nested(() => commands(src.slice(from, to), true)));
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "\\") {
      quoted = true;
      if (dq && !'$`"\\\n'.includes(next)) add(c);
      else if (src[++i] !== "\n") add(next ?? "");
    } else if (c === "$" && next === "{") {
      const j = match(i + 1, "{", "}");
      text(i + 2, j);
      add(src.slice(i, j + 1));
      i = j;
    } else if (c === "$" && next === "(") {
      // `$((…))` is arithmetic; `$((cmd) …)` a group opening a subshell
      if (next === src[i + 2] && arithmetic(i + 1)) {
        i = match(i + 1, "(", ")");
        add("\0");
      } else {
        open(")");
        i++;
      }
    } else if (c === "`") {
      if (ender === "`" && !dq) shut();
      else open("`");
    } else if (dq) {
      if (c !== '"' || (body && !frames.length)) add(c);
      else dq = false;
    } else if (c === '"') {
      dq = quoted = true;
      add("");
    } else if (c === "'" || (c === "$" && next === "'")) {
      // `$'…'` decodes its escapes, which can hide a quote; `'…'` has none
      let j = c === "'" ? i + 1 : i + 2;
      const from = j;
      while (j < src.length && src[j] !== "'") j += c === "$" && src[j] === "\\" ? 2 : 1;
      add(c === "'" ? src.slice(from, j) : ansi(src.slice(from, j)));
      quoted = true;
      i = j;
    } else if ((c === "<" || c === ">") && next === "(") {
      end();
      open(")");
      i++;
    } else if (c === "<" || c === ">" || (c === "&" && next === ">")) {
      if (/^\d+$/.test(word) && !quoted) word = undefined;
      end();
      const op = /^(?:<<<|<<-?|[<>&|]+)/.exec(src.slice(i, i + 3))[0];
      target = op === "<<" ? 2 : op === "<<-" ? 3 : 1;
      i += op.length - 1;
    } else if (c === "#" && word === undefined) i = to(src.indexOf("\n", i)) - 1;
    else if (c === " " || c === "\t" || c === "\r") end();
    else if (c === "(" && word?.endsWith("=")) {
      const j = match(i, "(", ")"); // an array literal
      text(i + 1, j);
      add("\0");
      i = j;
    } else if (c === "(" && next === "(" && word === undefined && !argv.length && arithmetic(i))
      i = match(i, "(", ")"); // `((…))` arithmetic, whose `<<` is a shift
    else if (c === "(" && ender === ")") {
      parens++;
      flush();
    } else if (c === ")" && ender === ")") {
      end(); // counts a pending `esac`
      if (parens) {
        parens--;
        flush();
      } else if (cases > 0) flush();
      else shut();
    } else if (c === "\n") {
      flush();
      let p = i + 1; // where the next body starts
      for (const [delimiter, isQuoted, strip] of heredocs.splice(0)) {
        let j = p;
        for (let eol; j < src.length; j = eol + 1) {
          eol = to(src.indexOf("\n", j));
          if (src.slice(j, eol).replace(strip ? /^\t+/ : /^$/, "") === delimiter) break;
        }
        if (!isQuoted) out.push(...nested(() => commands(src.slice(p, j), true)));
        p = to(src.indexOf("\n", j)) + 1;
      }
      i = p - 1;
    } else if (";&|()".includes(c)) flush();
    else add(c);
  }
  while (frames.length) shut();
  flush();
  return out;
}

/** Decodes a `$'…'` string's escapes. */
const ansi = (text) =>
  text.replace(/\\(x[\da-fA-F]{1,2}|u[\da-fA-F]{1,4}|[0-7]{1,3}|.)/gs, (_, e) =>
    /^[xu]/.test(e)
      ? String.fromCodePoint(Number.parseInt(e.slice(1), 16))
      : /^[0-7]/.test(e)
        ? String.fromCharCode(Number.parseInt(e, 8))
        : ({ a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" }[e] ?? e),
  );

/** Whether option word `w` takes the next word as its value: a long one in `long`, or a short cluster ending in a letter of `takes`. */
const valued = (w, takes, long) =>
  w.startsWith("--")
    ? long.includes(w)
    : !!takes && new RegExp(`^-[^-${takes}]*[${takes}]$`).test(w);

/** Splits arguments, options anywhere, into option words (`--` excluded) and positionals, a value skipped. */
function opts(args, takes, long = []) {
  const flags = [];
  const pos = [];
  for (let k = 0, dd = false; k < args.length; k++) {
    const w = args[k];
    if (dd || !w.startsWith("-") || w === "-") pos.push(w);
    else if (w === "--") dd = true;
    else {
      flags.push(w);
      if (valued(w, takes, long)) k++;
    }
  }
  return { flags, pos };
}

/** The guard a git invocation's arguments trip; `alias` when an inline config set an alias or include. */
function git(args, alias) {
  let k = 0;
  for (let w; (w = args[k])?.startsWith("-"); k++) {
    if (w === "--exec-path") return; // prints the path and exits
    const value =
      /^(?:-[Cc]|--(?:attr-source|config-env|git-dir|namespace|super-prefix|work-tree))$/.test(w)
        ? args[++k]
        : /^(?:-c|--config-env=)(.*)/s.exec(w)?.[1];
    alias ||= /^-c|^--config-env/.test(w) && /^(?:alias|include(?:if)?)\./i.test(value ?? "");
  }
  if (alias) return "checkout";
  const [sub, ...rest] = args.slice(k);
  if (rest[0] === "-h" || rest[0] === "--help") return;
  const any = (takes, long, re) => opts(rest, takes, long).flags.some((w) => re.test(w));
  switch (sub) {
    case "checkout": {
      const { flags, pos } = opts(rest, "bB", ["--orphan"]);
      const tripped =
        rest.includes("--") ||
        pos.length > 1 ||
        /^\.|^:\/?$|\/$|[*?[]/.test(pos[0]) ||
        flags.some((w) => /^--(?:f\w*|ours|theirs|pathspec-fr[\w-]*(?:=.*)?)$|^-[^-bB]*f/s.test(w));
      return tripped ? "checkout" : undefined;
    }
    case "checkout-index":
      return any("", ["--prefix"], /^--f|^-[^-]*f/) && !rest.some((w) => w.startsWith("--prefix"))
        ? "checkout"
        : undefined;
    case "clean":
      return any("e", ["--exclude"], /^--d|^-[^-e]*n/) ? undefined : "clean";
    case "push": {
      const { flags, pos } = opts(rest, "o", ["--push-option", "--repo"]);
      const force = flags.some((w) => /^--forc(?:e(?:-w[\w-]*)?)?(?:=|$)|^-[^-o]*f/.test(w));
      return force || pos.some((w) => w.startsWith("+")) ? "force" : undefined;
    }
    case "read-tree":
      return any("", [], /^--res|^-[^-]*u/) ? "checkout" : undefined;
    case "reset":
      return rest.some((w) => /^--ha(?:rd?)?(?:=|$)/.test(w)) ? "reset" : undefined;
    case "restore":
      return any("s", ["--source"], /^--w|^-[^-s]*W/) || !any("s", ["--source"], /^--st|^-[^-s]*S/)
        ? "checkout"
        : undefined;
    case "stash":
      return /^(?:list|show)$/.test(rest[0]) ? undefined : "stash";
    case "switch":
      return any("cC", [], /^--(?:di[\w-]*|force)$|^-[^-cC]*f/) ? "checkout" : undefined;
  }
}

/**
 * The guard one command's argv trips: past `VAR=value` words, keywords and wrappers with their options
 * (`sudo -u me`, `mise x node@22 --`, `timeout 5`), into `sh -c`/`eval` strings and `find -exec` commands,
 * the command word matched by basename. An inline `GIT_CONFIG_KEY_<n>=alias.…` counts as `git -c alias.…`.
 */
function judge(argv) {
  let alias = false;
  for (let i = 0; ;) {
    const w = argv[i];
    if (w === undefined) return;
    if (/^[A-Za-z_]\w*\+?=/.test(w)) {
      alias ||= /^GIT_CONFIG_(?:KEY_\d+|PARAMETERS)=(?:.*[\s'"])?(?:alias|include(?:if)?)\./is.test(
        w,
      );
      i++;
      continue;
    }
    if (/^command$/i.test(w) && /^-[^-]*[vV]/.test(argv[i + 1])) return; // names, never runs
    if (KEYWORDS.has(w)) {
      i += w === "function" ? 2 : 1;
      continue;
    }
    // a case-insensitive filesystem runs `GIT` as git
    const name = w.slice(w.lastIndexOf("/") + 1).toLowerCase();
    let x = i + 1; // mise's `x`/`exec`, past its global options
    while (name === "mise" && argv[x]?.startsWith("-")) x += valued(argv[x], "CEj", LONG) ? 2 : 1;
    const tool = name === "mise" && /^(?:x|exec)$/.test(argv[x]);
    if (tool || Object.hasOwn(WRAPPERS, name)) {
      for (i = tool ? x + 1 : i + 1; argv[i]?.startsWith("-") && argv[i] !== "-"; i++) {
        if (argv[i] === "--") {
          i++;
          break;
        }
        if (valued(argv[i], tool ? "CEj" : WRAPPERS[name], LONG)) i++;
      }
      while (tool && /^[^-].*@/.test(argv[i] ?? "")) i++;
      if (tool && argv[i] === "--") i++;
      i += LEADS[name] ?? 0;
      continue;
    }
    if (name === "eval") {
      while (argv[++i]?.toLowerCase() === "eval");
      return nested(() => verdict(argv.slice(i).join(" ")));
    }
    if (/^(?:ba|da|fi|k|z)?sh$/.test(name)) {
      const c = argv.findIndex((a, k) => k > i && /^-[^-]*c/.test(a));
      return c < 0 ? undefined : nested(() => verdict(argv[c + 1] ?? ""));
    }
    if (name === "find")
      for (let k = i + 1; k < argv.length; k++) {
        if (!/^-(?:exec|ok)(?:dir)?$/.test(argv[k])) continue;
        let stop = k + 1;
        while (stop < argv.length && argv[stop] !== ";" && argv[stop] !== "+") stop++;
        const found = nested(() => judge(argv.slice(k + 1, stop)));
        if (found) return found;
        k = stop;
      }
    if (name === "git") return git(argv.slice(i + 1), alias);
    if (name === "pkill")
      return opts(argv.slice(i + 1), "FGgJPstUu").flags.some((f) =>
        /^--full$|^-[^-FGgJPstUu]*f/.test(f),
      )
        ? "pkill"
        : undefined;
    return;
  }
}

let nesting = 0;

/** Reads one level deeper into a nested command; past NEST levels it throws, and the hook denies. */
function nested(read) {
  if (nesting >= NEST) throw new RangeError("nested too deep");
  nesting++;
  try {
    return read();
  } finally {
    nesting--;
  }
}

/** The first guard any command in a Bash command line trips. */
function verdict(src) {
  for (const argv of commands(src)) {
    const found = judge(argv);
    if (found) return found;
  }
}

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
    let reason;
    try {
      reason = DENY[verdict(e.command)];
    } catch {
      reason = DENY.deep; // what the guard cannot read, it cannot pass
    }
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
