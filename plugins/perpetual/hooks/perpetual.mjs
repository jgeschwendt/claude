// perpetual: observes and displays the sandman shift; never blocks, rewrites or approves.

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

const REFRESH_MS = 15000;
const REPEAT_JACCARD = 0.8;
const REPEAT_MIN_TOKENS = 3;
const TRAIL_DEFAULT_LINES = 10;

/** @type {{ home: string | undefined, last: any, prompts: Set<string>[], shift: any, timer: { cancel(): void } | undefined }} */
const state = { home: undefined, last: null, prompts: [], shift: null, timer: undefined };

/**
 * Appends one correction event to the trail; a failure is logged, never raised.
 * @param {any} $
 * @param {string} rationale
 */
async function append($, rationale) {
  const home = await homeOf($);
  const argv = [
    `${home}/.local/bin/sandman`,
    "trail",
    "append",
    "--kind",
    "correction",
    "--rationale",
    rationale,
    "--ref",
    `session:${await $.session.id()}`,
  ];
  const shift = await $.env.get("SANDMAN_SHIFT");
  if (shift) argv.push("--shift", shift);
  try {
    const { exitCode, stderr } = await $.process.run(argv, { timeoutMs: 5000 });
    if (exitCode !== 0)
      $.ui.log(`perpetual: sandman trail append exited ${exitCode}: ${stderr.trim().split("\n")[0]}`);
  } catch (error) {
    $.ui.log(`perpetual: sandman trail append failed: ${error}`);
  }
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
 * Runs a sandman verb for a command and logs what it printed.
 * @param {any} $
 * @param {string[]} args
 * @param {(stdout: string) => string} shape
 */
async function show($, args, shape) {
  const home = await homeOf($);
  try {
    const { exitCode, stderr, stdout } = await $.process.run([
      `${home}/.local/bin/sandman`,
      ...args,
    ]);
    const text = exitCode === 0 ? shape(stdout) : stderr.trim() || `exited ${exitCode}`;
    $.ui.log(text || "(empty)");
  } catch (error) {
    $.ui.log(`perpetual: sandman ${args.join(" ")} failed: ${error}`);
  }
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

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on("command.run", { command: "shift" }, async ($) => {
    await show($, ["shift", "status"], (stdout) => stdout.trim());
    return {};
  });

  on("command.run", { command: "trail" }, async ($, e) => {
    const n = Number.parseInt(e.args.trim(), 10);
    const count = Number.isInteger(n) && n > 0 ? n : TRAIL_DEFAULT_LINES;
    await show($, ["trail", "log"], (stdout) =>
      stdout.trimEnd().split("\n").slice(-count).join("\n"),
    );
    return {};
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
    if (isRepeat) await append($, `repeated instruction: ${head}`);
    else if (CORRECTION.some((pattern) => pattern.test(e.text))) await append($, head);
    return next(e);
  }).catch(($, e, next) => next(e)); // observe-only: a failed capture never holds the prompt

  on("session.start", async ($, e, next) => {
    await $.command.register({
      description: "Shows the current sandman shift (log only).",
      immediate: true,
      name: "shift",
    });
    await $.command.register({
      argumentHint: "[n]",
      description: "Shows the last n trail events, 10 by default (log only).",
      immediate: true,
      name: "trail",
    });
    if (e.isInteractive && e.surface !== null) {
      await refresh($);
      state.timer?.cancel();
      state.timer = $.clock.every(REFRESH_MS, () => refresh($));
    }
    return next(e);
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
