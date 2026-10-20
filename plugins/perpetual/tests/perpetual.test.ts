import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

const BAND = { component: "AbovePrompt", plugin: "perpetual", surface: "terminal" } as const;
const HOME = "/home/test";
const BIN = `${HOME}/.local/bin`;
const NOW = Date.UTC(2026, 9, 9, 12, 0);
const FIVE = { kind: "five_hour", percentUsed: 31.4, resetsAt: "2026-10-09T15:00:00.000Z" };

/**
 * Stubs the engine beneath the mod: env, clock, files, processes, logs, session, usage.
 * `outs` answers a process by its argv after the bin dir (`sandman recall --hook`); with `slow`
 * every process answers only after the clock moves 100 ms. Returns what the mod did.
 */
function world(
  on: On,
  files: Record<string, string> = {},
  {
    env = {},
    outs = {},
    rateLimits = () => [],
    slow = false,
  }: {
    env?: Record<string, string>;
    outs?: Record<string, { exitCode?: number; stderr?: string; stdout?: string } | "deny">;
    rateLimits?: () => object[];
    slow?: boolean;
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
    ["session.usage", () => ({ value: { context: {}, rateLimits: rateLimits(), startedAt: 0 } })],
    ["tool.call", () => ({ result: "ran" })],
    ["ui.render", () => ({ children: ["engine"], props: {}, type: "Text" })],
  ] as const)
    on(name as any, answer as any);
  on("fs.read", ($, e) => {
    reads.push(e.path);
    const text = files[e.path];
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on("fs.list", ($, e) => {
    const names = Object.keys(files).filter((path) => path.startsWith(`${e.path}/`));
    if (!names.length) return { deny: `ENOENT: ${e.path}` };
    return { value: names.map((path) => ({ name: path.slice(e.path.length + 1) })) as any };
  });
  on("fs.write", ($, e: any) => {
    writes.push([e.path, e.text]);
    return e.path.includes("/denied/") ? { deny: "EACCES" } : { value: undefined };
  });
  on("process.run", async ($, e): Promise<any> => {
    runs.push([...e.argv]);
    inits.push(e.init);
    if (slow) await clock.sleep(100);
    const out = outs[e.argv.join(" ").replace(`${BIN}/`, "")] ?? {};
    if (out === "deny") return { deny: "spawn ENOENT" };
    return { value: { exitCode: 0, stderr: "", stdout: "", ...out } };
  });
  on("ui.log", ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { clock, inits, logs, reads, runs, writes };
}

const command = ($: any, command: string, args = "") => $.command.run({ args, command });

const measure = ($: any) => $.session.measure({ changed: [] });

const start = ($: any, surface: string | null = "terminal") =>
  $.session.start({ isInteractive: !!surface, surface });

const submit = ($: any, text: string, origin: object = { kind: "composer" }) =>
  $.prompt.submit({ origin, text });

test("band draws the shift's clock and the last trail event, truncated, refreshed every 15 s", async ($, on) => {
  const file = `${HOME}/.sandman/shifts/current.json`;
  const trail = `${HOME}/.sandman/trail/2026/10/09.jsonl`;
  const files: Record<string, string> = {};
  const { clock, reads } = world(on, files);
  const draw = async (shift?: object, props = {}) => {
    files[file] = JSON.stringify(shift)!;
    await clock.advance(15000);
    const ui = await $.ui.mount({
      ...BAND,
      props: { bodyColumns: 200, hasSurvey: false, ...props },
    });
    const text = (await ui.find({ type: "Text" }))?.text;
    await ui.unmount();
    return text;
  };
  await start($);
  await start($);
  expect(await draw()).toBe("engine");
  expect(await draw({ handoff_by: "2026-10-09T13:05:30Z", shift: "s" })).toBe("⟳ s · 1h05m left");
  expect(await draw({ handoff_by: "2026-10-09T12:45:45Z", shift: "s" })).toBe("⟳ s · 45m left");
  expect(await draw({ handoff_by: "2026-10-09T11:00:00Z", shift: "s" })).toBe("⟳ s · handoff due");
  expect(await draw({ handoff_by: "tonight", shift: "s" })).toBe("⟳ s · tonight");
  expect(await draw({ shift: "s" }, { bodyColumns: 0 })).toBe("…");
  files[trail] = '{"kind":"x"}\n{"kind":"change"}\n';
  expect(await draw()).toBe("⟳ last: change");
  files[trail] = '{"kind":"correction","rationale":"never stash"}\n';
  const shift = { repo: "jgeschwendt/sandman", shift: "bootstrap", theme: "creation week" };
  expect(await draw(shift)).toBe(
    "⟳ bootstrap · creation week · jgeschwendt/sandman · last: correction never stash",
  );
  expect(await draw(shift, { hasSurvey: true })).toBe("engine");
  expect(reads).toHaveLength(22);
});

test("a correction prompt at the composer appends to the trail, a failure only logged; others append nothing", async ($, on) => {
  const text = "No, don't stash in the shared tree";
  const { logs, runs } = world(
    on,
    {},
    {
      outs: {
        [`sandman trail append --kind correction --rationale ${text} --ref session:sess-1`]: "deny",
      },
    },
  );
  await submit($, "add a band above the prompt");
  await submit($, "never mind that", { kind: "task-notification" });
  expect(await submit($, text)).toEqual({ text });
  expect(runs).toEqual([
    [
      `${BIN}/sandman`,
      "trail",
      "append",
      "--kind",
      "correction",
      "--rationale",
      text,
      "--ref",
      "session:sess-1",
    ],
  ]);
  expect(logs).toEqual([expect.stringMatching(/^perpetual: sandman trail append failed: /)]);
});

test("a correction carries SANDMAN_SHIFT when set", async ($, on) => {
  const { runs } = world(on, {}, { env: { SANDMAN_SHIFT: "bootstrap-2026-10-09" } });
  await submit($, "that is wrong");
  expect(runs[0]?.slice(-2)).toEqual(["--shift", "bootstrap-2026-10-09"]);
});

test("a repeated prompt of three or more words is flagged as a repeated instruction", async ($, on) => {
  const { runs } = world(on);
  await submit($, "go on");
  await submit($, "go on");
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
  expect(runs).toEqual([]);
  await submit($, "never stash in a shared tree");
  expect(runs[0]?.[6]).toBe("never stash in a shared tree");
});

test("/trail 5, /shift and /docket log their binary's output and answer nothing", async ($, on) => {
  const lines = Array.from({ length: 12 }, (_, i) => `event ${i + 1}`).join("\n");
  const { logs, runs } = world(
    on,
    {},
    {
      outs: {
        "docket list": { exitCode: 2, stderr: "down\n" },
        "sandman shift status": { stdout: "\n" },
        "sandman trail log": { stdout: lines + "\n" },
      },
    },
  );
  await start($);
  expect(await command($, "trail", "5")).toEqual({});
  expect(await command($, "trail", "0")).toEqual({});
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
    "(empty)",
    "perpetual: docket list exited 2: down",
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
      slow: true,
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

test("a failing or contextless hook binary is a log line or nothing, and adds nothing", async ($, on) => {
  const { logs } = world(
    on,
    {},
    {
      outs: {
        "docket --hook": { stdout: "{bad}" },
        "sandman recall --hook": { exitCode: 1, stderr: "boom\nmore" },
        "sandman report --hook": { stdout: '{"suppressOutput":true}' },
      },
    },
  );
  expect(await $.classic.SessionStart({ source: "startup" })).toEqual({
    additionalContext: ["settings"],
  });
  expect(logs).toEqual(["perpetual: sandman recall --hook exited 1: boom"]);
});

test("UserPromptSubmit adds docket's pull; Stop and permission notifications run docket beside", async ($, on) => {
  const { inits, runs } = world(on, {}, { outs: { "docket --hook": { stdout: "- t1\n" } } });
  expect(await $.classic.UserPromptSubmit({ prompt: "hi" })).toEqual({
    additionalContext: ["- t1"],
  });
  expect(
    await $.classic.Stop({ last_assistant_message: "result: done", stop_hook_active: false }),
  ).toEqual({});
  expect(
    await $.classic.Notification({ message: "needs you", notification_type: "permission_prompt" }),
  ).toEqual({});
  await $.classic.Notification({ message: "signed in", notification_type: "auth_success" });
  expect(runs).toEqual(Array(3).fill([`${BIN}/docket`, "--hook"]));
  expect(inits.map((init) => JSON.parse(init.stdin).hook_event_name)).toEqual([
    "UserPromptSubmit",
    "Stop",
    "Notification",
  ]);
});

test("SessionEnd runs sandman take and resolves the session's docket threads inside the 1.5 s budget", async ($, on) => {
  const { inits, runs } = world(on);
  await $.classic.SessionEnd({ reason: "prompt_input_exit", session_id: "sess-1" });
  expect(runs).toEqual([
    [`${BIN}/sandman`, "take", "--hook"],
    [`${BIN}/docket`, "resolve", "--key", "session:sess-1", "--reason", "session ended"],
  ]);
  expect(inits.map((init) => init.timeoutMs)).toEqual([1500, 1500]);
  expect(JSON.parse(inits[0].stdin)).toMatchObject({ reason: "prompt_input_exit" });
});

test("SessionStart resolves the notification problems of unregistered sessions, only once the registry lists this one", async ($, on) => {
  const dir = `${HOME}/.claude/sessions`;
  const files: Record<string, string> = {};
  const thread = (id: string, kind: string, key: string | null, body = "waiting") => ({
    id,
    key,
    kind,
    messages: [{ body }],
    title: "waiting",
  });
  const outs: Record<string, object> = {
    "docket list --json": {
      stdout: JSON.stringify([
        thread("t1", "problem", "session:dead"),
        thread("t2", "problem", "session:live"),
        thread("t3", "problem", "session:sess-1"),
        thread("t4", "decision", "session:dead"),
        thread("t5", "problem", "proposal:x"),
        thread("t6", "problem", null),
        thread("t7", "problem", "session:dead", "failed: x\nmore"),
      ]),
    },
  };
  const { runs } = world(on, files, { outs });
  const sweeps = async () => {
    expect(await $.classic.SessionStart({ source: "startup" })).toEqual({
      additionalContext: ["settings"],
    });
    return runs.filter((argv) => argv[1] === "list" || argv[1] === "resolve");
  };
  expect(await sweeps()).toEqual([]);
  files[`${dir}/2.json`] = JSON.stringify({ sessionId: "live" });
  files[`${dir}/2.abc.key`] = "secret";
  files[`${dir}/3.json`] = "{";
  expect(await sweeps()).toEqual([]);
  files[`${dir}/1.json`] = JSON.stringify({ sessionId: "sess-1" });
  const swept = [
    [`${BIN}/docket`, "list", "--json"],
    [`${BIN}/docket`, "resolve", "t1", "--reason", "session gone"],
  ];
  expect(await sweeps()).toEqual(swept);
  outs["docket list --json"] = { stdout: "{}" };
  expect(await sweeps()).toEqual([...swept, swept[0]]);
});

test("the five-hour window is written atomically at a headless start and on each measure with both figures", async ($, on) => {
  const usage = [
    [{ kind: "seven_day", percentUsed: 9 }, FIVE],
    [FIVE],
    [],
    [{ kind: "five_hour", percentUsed: 3 }],
    [{ ...FIVE, percentUsed: undefined }],
  ];
  const { reads, runs, writes } = world(on, {}, { rateLimits: () => usage.shift()! });
  await start($, null);
  expect(reads).toEqual([]);
  const path = `${HOME}/.local/state/claude/window.json`;
  expect(writes).toEqual([
    [
      `${path}.sess-1.tmp`,
      '{"at":"2026-10-09T12:00:00Z","five_hour":{"resets_at":1791558000,"used_percentage":31.4},"session_id":"sess-1"}',
    ],
  ]);
  expect(runs).toEqual([["/bin/mv", "-f", `${path}.sess-1.tmp`, path]]);
  while (usage.length) await measure($);
  expect(writes).toHaveLength(2);
});

test("the window goes under $XDG_STATE_HOME; a failed write is logged", async ($, on) => {
  const { logs, writes } = world(
    on,
    {},
    { env: { XDG_STATE_HOME: "/denied" }, rateLimits: () => [FIVE] },
  );
  await measure($);
  expect(writes[0]?.[0]).toBe("/denied/claude/window.json.sess-1.tmp");
  expect(logs).toEqual([expect.stringMatching(/^perpetual: window.json write failed: /)]);
});

test("$CLAUDE_WINDOW_FILE names the window file over $XDG_STATE_HOME", async ($, on) => {
  const { writes } = world(
    on,
    {},
    { env: { CLAUDE_WINDOW_FILE: "/w.json", XDG_STATE_HOME: "/x" }, rateLimits: () => [FIVE] },
  );
  await measure($);
  expect(writes[0]?.[0]).toBe("/w.json.sess-1.tmp");
});

test("guards deny the house-forbidden commands and .yml writes, trailing each denial", async ($, on) => {
  const { runs } = world(on);
  const denied = {
    "YAML files end in": ["/r/.github/ci.yml"],
    "git checkout --": [
      "cd x && git checkout -- src/a.rs",
      "git -C /r checkout HEAD -- .",
      "git --work-tree /x checkout -- f",
    ],
    "git clean": ["git clean -fd", "sudo git clean -fdx", "for r in a b; do git clean -fd; done"],
    "git reset --hard": ["git reset --hard origin/main", "if true; then git reset --hard; fi"],
    "never `git stash`": [
      "git stash",
      "git stash pop",
      'git -C "/r/my dir" stash',
      "git --git-dir /r/.git stash",
      "git -P stash",
      "git --no-pager stash",
    ],
    "never force-push": [
      "git push --force origin x",
      "git push -f",
      "git push --force-with-lease",
      "git push -fu origin main",
      "git push origin +main",
      "GIT_DIR=/r/.git git push -f",
      "env git push -f",
    ],
    "pkill -f matches every process": ["pkill -f node", "pkill --full node"],
  };
  for (const [rule, subjects] of Object.entries(denied))
    for (const subject of subjects) {
      const tool = rule.startsWith("YAML") ? "Write" : "Bash";
      const call = { command: subject, content: "", file_path: subject, tool };
      expect(await $.tool.call(call as any)).toEqual({ deny: expect.stringContaining(rule) });
      expect(runs.at(-1)?.slice(4, 7)).toEqual([
        "guard",
        "--rationale",
        expect.stringContaining(`: ${subject}`),
      ]);
    }
  for (const command of [
    "git stash list",
    "git checkout main",
    "git push origin mod",
    "pkill node",
    "git reset HEAD~1",
    'git commit -m "never git stash"',
    "git checkout main\nls -- src",
    "git push origin main\nls -f",
    "git reset HEAD~1\ngrep --hard x",
    "pkill -x node\nls -f",
    "git push --follow-tags origin main",
    "git --no-pager show stash@{0}",
    "git --no-pager diff stash@{0} -- f",
    "git --no-pager grep clean",
    "git --no-pager log --grep stash",
    `git ${"--a ".repeat(5000)}`,
  ])
    expect(await $.tool.call({ tool: "Bash", command })).toEqual({ result: "ran" });
  expect(
    await $.tool.call({ tool: "Edit", file_path: "/r/ci.yaml", new_string: "b", old_string: "a" }),
  ).toEqual({ result: "ran" });
  expect(runs).toHaveLength(Object.values(denied).flat().length);
});

test("an agent spawn without a model is pinned to opus; a pinned one or a fork is left alone", async ($, on) => {
  world(on);
  expect(await $.agent.spawn({} as any)).toEqual({ model: "opus" });
  expect(await $.agent.spawn({ model: "haiku" } as any)).toEqual({ model: "haiku" });
  expect(await $.agent.spawn({ fork: true } as any)).toEqual({ model: "inherited" });
});
