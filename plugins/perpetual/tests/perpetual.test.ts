import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

const BAND = {
  component: "AbovePrompt",
  plugin: "perpetual",
  props: {
    bodyColumns: 200,
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    scroll: { bodyRows: 4, offset: 0 },
    view: {},
  },
} as const;
const HOME = "/home/test";
const BIN = `${HOME}/.local/bin`;
const NOW = Date.UTC(2026, 9, 9, 12, 0);
const SHIFT = {
  handoff_by: "2026-10-09T13:30:00Z",
  repo: "jgeschwendt/sandman",
  shift: "bootstrap-2026-10-09",
  theme: "creation week",
};
const TRAIL = [
  { kind: "change", rationale: "first" },
  { kind: "correction", rationale: "never stash in a shared tree" },
];
const FIVE = { kind: "five_hour", percentUsed: 31.4, resetsAt: "2026-10-09T15:00:00.000Z" };

/**
 * Stubs the engine beneath the mod: env, clock, files, processes, logs, session, usage.
 * `outs` answers a process by its argv after the bin dir (`sandman recall --hook`); a process
 * named in `slow` answers only after the clock moves 100 ms. Returns what the mod did.
 */
function world(
  on: On,
  files: Record<string, string> = {},
  {
    env = {},
    outs = {},
    rateLimits = [],
    slow = [],
  }: {
    env?: Record<string, string>;
    outs?: Record<string, { exitCode?: number; stderr?: string; stdout?: string } | "deny">;
    rateLimits?: object[] | (() => object[]);
    slow?: string[];
  } = {},
) {
  const inits: any[] = [];
  const logs: string[] = [];
  const reads: string[] = [];
  const runs: string[][] = [];
  const writes: [string, string][] = [];
  mock.env(on, { HOME, ...env });
  const clock = mock.clock(on, { now: NOW });
  for (const [name, answer] of [
    ["agent.spawn", ($: any, e: any) => ({ model: e.model ?? "inherited" })],
    ["classic.Notification", () => ({})],
    ["classic.SessionEnd", () => ({})],
    ["classic.SessionStart", () => ({ additionalContext: ["settings"] })],
    ["classic.Stop", () => ({})],
    ["classic.UserPromptSubmit", () => ({})],
    ["command.register", () => ({ value: undefined })],
    ["prompt.submit", ($: any, e: any) => ({ text: e.text })],
    ["session.id", () => ({ value: "sess-1" })],
    ["session.measure", ($: any, e: any) => ({ changed: e.changed })],
    ["session.start", () => ({ cwd: "/work" })],
    [
      "session.usage",
      () => ({
        value: {
          context: {},
          rateLimits: typeof rateLimits === "function" ? rateLimits() : rateLimits,
          startedAt: 0,
        },
      }),
    ],
    ["tool.call", () => ({ result: "ran" })],
    ["ui.render", () => ({ children: ["engine"], props: {}, type: "Text" })],
  ] as const)
    on(name as any, answer as any);
  on("fs.read", ($, e) => {
    reads.push(e.path);
    const text = files[e.path];
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on("fs.write", ($, e: any) => {
    writes.push([e.path, e.text]);
    return e.path.includes("/denied/") ? { deny: "EACCES" } : { value: undefined };
  });
  on("process.run", async ($, e): Promise<any> => {
    runs.push([...e.argv]);
    inits.push(e.init);
    const key = e.argv.join(" ").replace(`${BIN}/`, "");
    if (slow.includes(key)) await clock.sleep(100);
    const out = outs[key] ?? {};
    if (out === "deny") return { deny: "spawn ENOENT" };
    return { value: { exitCode: 0, stderr: "", stdout: "", ...out } };
  });
  on("ui.log", ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { clock, inits, logs, reads, runs, writes };
}

const command = ($: any, name: string, args = "") =>
  $.command.run({
    args,
    command: name,
    origin: { kind: "composer" },
    presentation: { columns: 120, isFullscreen: true },
  });

const start = ($: any, isInteractive = true) =>
  $.session.start({ cwd: "/work", isInteractive, surface: isInteractive ? "terminal" : null });

const submit = ($: any, text: string, origin: object = { kind: "composer" }) =>
  $.prompt.submit({ origin, text, wait: false });

test("band draws the shift and the last trail event", async ($, on) => {
  world(on, {
    [`${HOME}/.sandman/shifts/current.json`]: JSON.stringify(SHIFT),
    [`${HOME}/.sandman/trail/2026/10/09.jsonl`]:
      TRAIL.map((line) => JSON.stringify(line)).join("\n") + "\n",
  });
  await start($);
  const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
  const band = await ui.find({ type: "Text", text: /^⟳/ });
  expect(band?.text).toBe(
    "⟳ bootstrap-2026-10-09 · creation week · jgeschwendt/sandman · 1h30m left · last: correction never stash in a shared tree",
  );
  await ui.unmount();
});

test("band clocks: minutes, due, unparseable; truncated to the body width", async ($, on) => {
  const file = `${HOME}/.sandman/shifts/current.json`;
  const files: Record<string, string> = {};
  const { clock } = world(on, files);
  const draw = async (handoff_by: string, bodyColumns = 200) => {
    files[file] = JSON.stringify({ handoff_by, shift: "s" });
    await clock.advance(15000);
    const ui = await $.ui.mount({
      ...BAND,
      props: { ...BAND.props, bodyColumns },
      surface: "terminal",
    });
    const text = (await ui.find({ type: "Text", text: /^⟳/ }))?.text;
    await ui.unmount();
    return text;
  };
  await start($);
  expect(await draw("2026-10-09T12:45:15Z")).toBe("⟳ s · 45m left");
  expect(await draw("2026-10-09T11:00:00Z")).toBe("⟳ s · handoff due");
  expect(await draw("tonight")).toBe("⟳ s · tonight");
  expect(await draw("tonight", 8)).toBe("⟳ s · t…");
});

test("band draws nothing without shift or trail files", async ($, on) => {
  world(on);
  await start($);
  const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /^⟳/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "engine" })).toBeDefined();
  await ui.unmount();
});

test("a correction prompt appends a correction to the trail", async ($, on) => {
  const { runs } = world(on);
  const out = await submit($, "No, don't stash in the shared tree");
  expect(out).toEqual({ text: "No, don't stash in the shared tree" });
  expect(runs).toEqual([
    [
      `${BIN}/sandman`,
      "trail",
      "append",
      "--kind",
      "correction",
      "--rationale",
      "No, don't stash in the shared tree",
      "--ref",
      "session:sess-1",
    ],
  ]);
});

test("a correction carries SANDMAN_SHIFT when set", async ($, on) => {
  const { runs } = world(on, {}, { env: { SANDMAN_SHIFT: "bootstrap-2026-10-09" } });
  await submit($, "that is wrong");
  expect(runs[0]?.slice(-2)).toEqual(["--shift", "bootstrap-2026-10-09"]);
});

test("a plain prompt, or one not typed at the composer, appends nothing", async ($, on) => {
  const { runs } = world(on);
  expect(await submit($, "add a band above the prompt")).toEqual({
    text: "add a band above the prompt",
  });
  await submit($, "stop everything", { kind: "plugin", name: "other" });
  await submit($, "never mind that", { kind: "task-notification" });
  expect(runs).toEqual([]);
});

test("a repeated prompt is flagged as a repeated instruction", async ($, on) => {
  const { runs } = world(on);
  await submit($, "pin every agent spawn to opus explicitly");
  expect(runs).toEqual([]);
  await submit($, "Pin every agent spawn to Opus, explicitly!");
  expect(runs).toHaveLength(1);
  expect(runs[0]?.[6]).toBe("repeated instruction: Pin every agent spawn to Opus, explicitly!");
});

test("a long prompt, a `# ` brief, or a --bg session's opening prompt appends nothing", async ($, on) => {
  const { runs } = world(on, {}, { env: { CLAUDE_CODE_SESSION_KIND: "bg" } });
  await submit($, "never stash in a shared tree");
  await submit($, "# Shift brief\nnever stash");
  await submit($, `never stash ${"x".repeat(400)}`);
  await submit($, `never stash ${"x".repeat(400)}`);
  expect(runs).toEqual([]);
  await submit($, "never stash in a shared tree");
  expect(runs[0]?.[6]).toBe("never stash in a shared tree");
});

test("a failed sandman call is logged and the prompt goes on", async ($, on) => {
  const { logs } = world(
    on,
    {},
    {
      outs: {
        "sandman trail append --kind correction --rationale stop that --ref session:sess-1": "deny",
      },
    },
  );
  expect(await submit($, "stop that")).toEqual({ text: "stop that" });
  expect(logs.join("\n")).toMatch(/^perpetual: sandman trail append failed: /);
});

test("headless: neither the band nor the capture runs", async ($, on) => {
  const { reads, runs } = world(on, {
    [`${HOME}/.sandman/shifts/current.json`]: JSON.stringify(SHIFT),
  });
  await start($, false);
  expect(reads).toEqual([]);
  await submit($, "never spawn an unpinned agent", { kind: "sdk" });
  await submit($, "never spawn an unpinned agent", { kind: "sdk" });
  expect(runs).toEqual([]);
});

test("/trail 5, /shift and /docket log their binary's output and answer nothing", async ($, on) => {
  const lines = Array.from({ length: 12 }, (_, i) => `event ${i + 1}`).join("\n");
  const { logs, runs } = world(
    on,
    {},
    {
      outs: {
        "docket list": { stdout: "" },
        "sandman shift status": { stdout: "shift bootstrap-2026-10-09\n" },
        "sandman trail log": { stdout: lines + "\n" },
      },
    },
  );
  await start($);
  expect(await command($, "trail", "5")).toEqual({});
  expect(await command($, "trail", "x")).toEqual({});
  expect(await command($, "shift")).toEqual({});
  expect(await command($, "docket")).toEqual({});
  expect(runs).toEqual([
    [`${BIN}/sandman`, "trail", "log"],
    [`${BIN}/sandman`, "trail", "log"],
    [`${BIN}/sandman`, "shift", "status"],
    [`${BIN}/docket`, "list"],
  ]);
  expect(logs).toEqual([
    "event 8\nevent 9\nevent 10\nevent 11\nevent 12",
    lines.split("\n").slice(-10).join("\n"),
    "shift bootstrap-2026-10-09",
    "(empty)",
  ]);
});

test("SessionStart runs recall, docket and report at once and adds their context in order", async ($, on) => {
  const reply = (additionalContext: string) =>
    JSON.stringify({ hookSpecificOutput: { additionalContext, hookEventName: "SessionStart" } });
  const { clock, inits, runs } = world(
    on,
    {},
    {
      outs: {
        "docket --hook": { stdout: "## threads waiting on you\n" },
        "sandman recall --hook": { stdout: reply("## Long-term index") },
        "sandman report --hook": { stdout: reply("# Reports") },
      },
      slow: ["docket --hook", "sandman recall --hook", "sandman report --hook"],
    },
  );
  const out = $.classic.SessionStart({ source: "startup" });
  await clock.settle();
  expect(runs).toEqual([
    [`${BIN}/sandman`, "recall", "--hook"],
    [`${BIN}/docket`, "--hook"],
    [`${BIN}/sandman`, "report", "--hook"],
  ]);
  await clock.advance(100);
  expect(await out).toEqual({
    additionalContext: ["settings", "## Long-term index", "## threads waiting on you", "# Reports"],
  });
  expect(inits.map((init) => init.timeoutMs)).toEqual([10000, 10000, 10000]);
  expect(JSON.parse(inits[0].stdin)).toMatchObject({
    hook_event_name: "SessionStart",
    source: "startup",
  });
});

test("a missing, failing or contextless hook binary is a log line and adds nothing", async ($, on) => {
  const { logs } = world(
    on,
    {},
    {
      outs: {
        "docket --hook": "deny",
        "sandman recall --hook": { exitCode: 1, stderr: "boom\nmore" },
        "sandman report --hook": { stdout: '{"suppressOutput":true}' },
      },
    },
  );
  expect(await $.classic.SessionStart({ source: "startup" })).toEqual({
    additionalContext: ["settings"],
  });
  expect(logs).toEqual([
    "perpetual: sandman recall --hook exited 1: boom",
    expect.stringMatching(/^perpetual: docket --hook failed: /),
  ]);
});

test("UserPromptSubmit adds docket's pull; Stop and permission notifications run docket", async ($, on) => {
  const { inits, runs } = world(on, {}, { outs: { "docket --hook": { stdout: "{bad}" } } });
  expect(await $.classic.UserPromptSubmit({ prompt: "hi" })).toEqual({});
  expect(
    await $.classic.Stop({ last_assistant_message: "result: done", stop_hook_active: false }),
  ).toEqual({});
  await $.classic.Notification({ message: "needs you", notification_type: "permission_prompt" });
  await $.classic.Notification({ message: "signed in", notification_type: "auth_success" });
  expect(runs).toEqual(Array(3).fill([`${BIN}/docket`, "--hook"]));
  expect(inits.map((init) => JSON.parse(init.stdin).hook_event_name)).toEqual([
    "UserPromptSubmit",
    "Stop",
    "Notification",
  ]);
});

test("UserPromptSubmit passes docket's plain-text pull as context", async ($, on) => {
  world(on, {}, { outs: { "docket --hook": { stdout: "## threads waiting on you\n- t1\n" } } });
  expect(await $.classic.UserPromptSubmit({ prompt: "hi" })).toEqual({
    additionalContext: ["## threads waiting on you\n- t1"],
  });
});

test("SessionEnd runs sandman take inside the 1.5 s budget", async ($, on) => {
  const { inits, runs } = world(on);
  await $.classic.SessionEnd({ reason: "prompt_input_exit" });
  expect(runs).toEqual([[`${BIN}/sandman`, "take", "--hook"]]);
  expect(inits[0].timeoutMs).toBe(1500);
  expect(JSON.parse(inits[0].stdin)).toMatchObject({ reason: "prompt_input_exit" });
});

test("the five-hour window is written atomically at start and on each measure", async ($, on) => {
  const { runs, writes } = world(
    on,
    {},
    { rateLimits: [{ kind: "seven_day", percentUsed: 9 }, FIVE] },
  );
  await start($, false);
  const path = `${HOME}/.local/state/claude/window.json`;
  expect(writes).toEqual([
    [
      `${path}.sess-1.tmp`,
      '{"at":"2026-10-09T12:00:00Z","five_hour":{"resets_at":1791558000,"used_percentage":31.4},"session_id":"sess-1"}',
    ],
  ]);
  expect(runs).toEqual([["/bin/mv", "-f", `${path}.sess-1.tmp`, path]]);
  await $.session.measure({ changed: ["rateLimits"], context: {} as any, rateLimits: [] });
  expect(writes).toHaveLength(2);
});

test("the window goes under $XDG_STATE_HOME; a failed write is logged", async ($, on) => {
  const { logs, writes } = world(
    on,
    {},
    { env: { XDG_STATE_HOME: "/denied" }, rateLimits: [FIVE] },
  );
  await $.session.measure({ changed: ["rateLimits"], context: {} as any, rateLimits: [] });
  expect(writes[0]?.[0]).toBe("/denied/claude/window.json.sess-1.tmp");
  expect(logs).toEqual([expect.stringMatching(/^perpetual: window.json write failed: /)]);
});

test("$CLAUDE_WINDOW_FILE names the window file; no window is written without both figures", async ($, on) => {
  const usage = [
    [FIVE],
    [{ kind: "five_hour", percentUsed: 3 }],
    [{ ...FIVE, percentUsed: undefined }],
  ];
  const { writes } = world(
    on,
    {},
    { env: { CLAUDE_WINDOW_FILE: "/w.json" }, rateLimits: () => usage.shift()! },
  );
  for (let i = 0; i < 3; i += 1)
    await $.session.measure({ changed: ["rateLimits"], context: {} as any, rateLimits: [] });
  expect(writes.map(([path]) => path)).toEqual(["/w.json.sess-1.tmp"]);
});

test("guards deny the house-forbidden commands and trail each denial", async ($, on) => {
  const { runs } = world(on);
  const denied = [
    ["pkill -f node", /pkill -f matches every process/],
    ["cd x && git checkout -- src/a.rs", /git checkout --/],
    ["git -C /r checkout HEAD -- .", /git checkout --/],
    ["git reset --hard origin/main", /git reset --hard/],
    ["git push --force origin x", /never force-push/],
    ["git push -f", /never force-push/],
    ["git push --force-with-lease", /never force-push/],
    ["git stash", /never `git stash`/],
    ["git stash pop", /never `git stash`/],
    ["git clean -fd", /git clean/],
  ] as const;
  for (const [command, reason] of denied) {
    const out: any = await $.tool.call({ tool: "Bash", command });
    expect(JSON.stringify(out)).toMatch(reason);
    expect(runs.at(-1)?.slice(0, 5)).toEqual([
      `${BIN}/sandman`,
      "trail",
      "append",
      "--kind",
      "guard",
    ]);
  }
  for (const command of [
    "git stash list",
    "git checkout main",
    "git push origin mod",
    "pkill node",
    "git reset HEAD~1",
    'git commit -m "never git stash"',
  ])
    expect(await $.tool.call({ tool: "Bash", command })).toMatchObject({ result: "ran" });
  expect(runs).toHaveLength(denied.length);
});

test("a .yml path is denied to Write and Edit; .yaml goes through", async ($, on) => {
  const { runs } = world(on);
  const out: any = await $.tool.call({
    tool: "Write",
    content: "",
    file_path: "/r/.github/ci.yml",
  });
  expect(JSON.stringify(out)).toMatch(/YAML files end in `.yaml`/);
  expect(runs).toHaveLength(1);
  expect(
    await $.tool.call({ tool: "Edit", file_path: "/r/ci.yaml", new_string: "b", old_string: "a" }),
  ).toMatchObject({
    result: "ran",
  });
});

test("an agent spawn without a model is pinned to opus; a pinned one or a fork is left alone", async ($, on) => {
  world(on);
  const spawn = (fields: object) =>
    $.agent.spawn({
      background: false,
      description: "d",
      fork: false,
      parentModel: "fable",
      prompt: "p",
      provider: { plugin: "engine", tier: "core" },
      subagentType: "general-purpose",
      tool_use_id: "t",
      ...fields,
    } as any);
  expect(await spawn({})).toMatchObject({ model: "opus" });
  expect(await spawn({ model: "haiku" })).toMatchObject({ model: "haiku" });
  expect(await spawn({ fork: true })).toMatchObject({ model: "inherited" });
});
