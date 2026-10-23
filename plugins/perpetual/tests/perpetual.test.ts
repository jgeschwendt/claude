import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

const BAND = { component: "AbovePrompt", plugin: "perpetual", surface: "terminal" } as const;
const HOME = "/home/test";
const BIN = `${HOME}/.local/bin`;
const NOW = Date.UTC(2026, 9, 9, 12, 0);
const FIVE = { kind: "five_hour", percentUsed: 31.4, resetsAt: "2026-10-09T15:00:00.999Z" };

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
  const registered: object[] = [];
  const runs: string[][] = [];
  const writes: [string, string][] = [];
  on("env.get", ($, e) => ({ value: ({ HOME, ...env } as Record<string, string>)[e.name] }));
  const clock = mock.clock(on, { now: NOW });
  for (const [name, answer] of [
    ["agent.spawn", ($: any, e: any) => ({ model: e.model ?? "inherited" })],
    ["classic.Notification", () => ({})],
    ["classic.SessionEnd", () => ({})],
    ["classic.SessionStart", () => ({ additionalContext: ["settings"] })],
    ["classic.Stop", () => ({})],
    ["classic.UserPromptSubmit", () => ({})],
    ["command.register", ($: any, e: any) => (registered.push(e), { value: undefined })],
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
  return { clock, env, inits, logs, reads, registered, runs, writes };
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
  let drawn;
  const draw = async (shift?: object, props = {}) => {
    files[file] = JSON.stringify(shift)!;
    await clock.advance(15000);
    const ui = await $.ui.mount({
      ...BAND,
      props: { bodyColumns: 200, hasSurvey: false, ...props },
    });
    const node: any = await ui.find({ type: "Text" });
    drawn = node.props;
    await ui.unmount();
    return node.text;
  };
  await start($);
  await start($);
  expect(await draw()).toBe("engine");
  expect(await draw({ handoff_by: "2026-10-09T13:05:30Z", shift: "s" })).toBe("⟳ s · 1h05m left");
  expect(await draw({ handoff_by: "2026-10-09T12:45:15Z", shift: "s" })).toBe("⟳ s · 45m left");
  expect(await draw({ handoff_by: "2026-10-09T12:01:00Z", shift: "s" })).toBe("⟳ s · handoff due");
  expect(await draw({ handoff_by: "tonight", shift: "s" }, { bodyColumns: 13 })).toBe(
    "⟳ s · tonight",
  );
  expect(await draw({ handoff_by: 0, shift: "s" })).toBe("⟳ s");
  expect(await draw({ shift: "s" }, { bodyColumns: 0 })).toBe("…");
  files[trail] = '{"kind":"x"}\n{"kind":"change"}\n';
  expect(await draw()).toBe("⟳ last: change");
  files[trail] = '{"kind":"correction","rationale":"never\\nstash"}\n';
  const shift = { repo: "jgeschwendt/sandman", shift: "bootstrap", theme: "creation week" };
  expect(await draw(shift)).toBe(
    "⟳ bootstrap · creation week · jgeschwendt/sandman · last: correction never stash",
  );
  expect(drawn).toEqual({ dimColor: true, wrap: "truncate-end" });
  expect(await draw(shift, { hasSurvey: true })).toBe("engine");
  expect(reads).toHaveLength(24);
});

test("a correction prompt at the composer appends its first 200 characters to the trail, a failure only logged; another origin, a long or `# ` prompt or a --bg session's opening prompt appends nothing", async ($, on) => {
  const text = "Please, don't stash in the shared tree";
  const opening = "never stash in a shared tree";
  const brief = `#1 never stash ${"x".repeat(385)}`;
  const { logs, runs } = world(
    on,
    {},
    {
      env: { CLAUDE_CODE_SESSION_KIND: "bg" },
      outs: {
        [`sandman trail append --kind correction --rationale ${text} --ref session:sess-1`]: "deny",
      },
    },
  );
  await submit($, "never mind that", { kind: "task-notification" });
  await submit($, opening);
  await submit($, "add a band above the prompt");
  await submit($, "# Shift brief\nnever stash");
  await submit($, opening.padEnd(401));
  expect(await submit($, text)).toEqual({ text });
  await submit($, brief);
  await submit($, opening);
  expect(runs.map((argv) => argv.join(" "))).toEqual(
    [text, brief.slice(0, 200), opening].map(
      (rationale) =>
        `${BIN}/sandman trail append --kind correction --rationale ${rationale} --ref session:sess-1`,
    ),
  );
  expect(logs).toEqual([expect.stringMatching(/^perpetual: sandman trail append failed: /)]);
});

test("every correction, and a repeat of three or more words, appends within 5 s carrying SANDMAN_SHIFT", async ($, on) => {
  const { inits, runs } = world(on, {}, { env: { SANDMAN_SHIFT: "s1" } });
  const corrections = [
    "that is wrong",
    "No.",
    "no way",
    "dont",
    "I said so",
    "not what I meant",
    "stop",
  ];
  const repeats = ["Let's go, now!", "Stop: bump Node 22, please!"];
  const said = ["let's go", "let's go", "let's go now", "bump node 22 please"];
  for (const text of [...corrections, ...said, ...repeats]) await submit($, text);
  expect(runs.map((argv) => argv.slice(6).join(" "))).toEqual(
    [...corrections, ...repeats.map((text) => `repeated instruction: ${text}`)].map(
      (rationale) => `${rationale} --ref session:sess-1 --shift s1`,
    ),
  );
  expect(inits).toEqual(Array(9).fill({ timeoutMs: 5000 }));
});

test("/trail 5, /shift and /docket log their binary's output and answer nothing", async ($, on) => {
  const lines = Array.from({ length: 12 }, (_, i) => `event ${i + 1}`).join("\n");
  const { logs, registered, runs } = world(
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
  expect(registered).toMatchObject([
    { immediate: true, name: "docket" },
    { immediate: true, name: "shift" },
    { argumentHint: "[n]", immediate: true, name: "trail" },
  ]);
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

test("SessionStart runs recall, docket, report and the sweep at once and adds their context in order", async ($, on) => {
  const reply = (additionalContext: string) =>
    JSON.stringify({ hookSpecificOutput: { additionalContext, hookEventName: "SessionStart" } });
  const { clock, inits, runs } = world(
    on,
    { [`${HOME}/.claude/sessions/1.json`]: '{"sessionId":"sess-1"}' },
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
    [`${BIN}/docket`, "list", "--json"],
  ]);
  await clock.advance(100);
  expect(await out).toEqual({
    additionalContext: ["settings", "## Long-term index", "## threads waiting on you", "# Reports"],
  });
  expect(inits.map((init) => init.timeoutMs)).toEqual([10000, 10000, 10000, 5000]);
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
        "sandman recall --hook": { exitCode: 1, stderr: "\nboom\nmore" },
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
  for (const notification_type of [
    "agent_needs_input",
    "auth_success",
    "idle_prompt",
    "permission_prompt",
  ])
    expect(await $.classic.Notification({ message: "m", notification_type })).toEqual({});
  expect(runs).toEqual(Array(5).fill([`${BIN}/docket`, "--hook"]));
  expect(inits.map((init) => JSON.parse(init.stdin).hook_event_name)).toEqual([
    "UserPromptSubmit",
    "Stop",
    ...Array(3).fill("Notification"),
  ]);
});

test("SessionEnd runs sandman take and resolves the session's docket threads inside the 1.5 s budget", async ($, on) => {
  const { clock, inits, runs } = world(on, {}, { slow: true });
  const out = $.classic.SessionEnd({ reason: "prompt_input_exit", session_id: "sess-1" });
  await clock.settle();
  expect(runs).toEqual([
    [`${BIN}/sandman`, "take", "--hook"],
    [`${BIN}/docket`, "resolve", "--key", "session:sess-1", "--reason", "session ended"],
  ]);
  await clock.advance(100);
  await out;
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
    messages: [{ body: "waiting" }, { body }],
    title: "waiting",
  });
  const outs: Record<string, object> = {
    "docket --hook": { stdout: "- t1" },
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
    "sandman report --hook": { stdout: '{"hookSpecificOutput":{"additionalContext":1}}' },
  };
  const { inits, runs } = world(on, files, { outs });
  const sweeps = async () => {
    expect(await $.classic.SessionStart({ source: "startup" })).toEqual({
      additionalContext: ["settings", "- t1"],
    });
    return runs.filter((argv) => argv[1] === "list" || argv[1] === "resolve");
  };
  expect(await sweeps()).toEqual([]);
  files[`${dir}/2.json`] = JSON.stringify({ sessionId: "live" });
  files[`${dir}/2.abc.key`] = JSON.stringify({ sessionId: "dead" });
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
  expect(inits.filter((init) => !init.stdin)).toEqual(Array(3).fill({ timeoutMs: 5000 }));
});

test("the five-hour window is written atomically at a headless start and on each measure with both figures, to $CLAUDE_WINDOW_FILE, else $XDG_STATE_HOME (a failed write logged), else ~/.local/state", async ($, on) => {
  const usage = [
    [{ kind: "seven_day", percentUsed: 9 }, FIVE],
    [],
    [{ kind: "five_hour", percentUsed: 3 }],
    [{ ...FIVE, percentUsed: undefined }],
    [FIVE],
    [FIVE],
  ];
  const { env, logs, reads, runs, writes } = world(
    on,
    {},
    { env: { CLAUDE_WINDOW_FILE: "", XDG_STATE_HOME: "" }, rateLimits: () => usage.shift()! },
  );
  await start($, null);
  expect(reads).toEqual([]);
  for (const set of [{}, {}, {}, { XDG_STATE_HOME: "/denied" }, { CLAUDE_WINDOW_FILE: "/w.json" }])
    (Object.assign(env, set), await measure($));
  const path = `${HOME}/.local/state/claude/window.json`;
  const json =
    '{"at":"2026-10-09T12:00:00Z","five_hour":{"resets_at":1791558000,"used_percentage":31.4},"session_id":"sess-1"}';
  expect(writes).toEqual(
    [path, "/denied/claude/window.json", "/w.json"].map((file) => [`${file}.sess-1.tmp`, json]),
  );
  expect(runs).toEqual(
    [path, "/w.json"].map((file) => ["/bin/mv", "-f", `${file}.sess-1.tmp`, file]),
  );
  expect(logs).toEqual([expect.stringMatching(/^perpetual: window.json write failed: /)]);
});

test("guards deny the house-forbidden commands and .yml writes, trailing each denial", async ($, on) => {
  const { runs } = world(on);
  const denied = {
    "YAML files end in": ["/r/.github/ci.YML", "/r/a.yml"],
    "git checkout --": [
      "cd x && git checkout -- src/a.rs",
      "git checkout HEAD --",
      "git -C /r checkout HEAD -- .",
      "git --work-tree /x checkout -- f",
      "xargs -0 git checkout -- f",
      "xargs -I{} git checkout -- {}",
      "find . -name '*.rs' -exec git checkout -- {} \\;",
      "find . -okdir git restore {} +",
      "git checkout .",
      "git checkout -f",
      "git checkout -fb x",
      "git checkout --force main",
      "git switch -f x",
      "git switch --discard-changes x",
      "git switch --force x",
      "git restore f",
      "git restore .",
      "git restore --staged --worktree f",
      "git restore -SW f",
      "git restore --source=X f",
      "git checkout --pathspec-from-file=f",
      "git checkout HEAD --pathspec-fr f",
      "git restore --pathspec-from-file=f",
      "git read-tree -u --reset HEAD",
      "git read-tree --reset HEAD",
      "git read-tree -mu HEAD",
      "git -c alias.n='reset --hard' n",
      "git -c alias.n='!git reset --hard' n",
      "git -c 'ALIAS.n=checkout -- .' n",
      "git --config-env=alias.n=V n",
      "git -C /r --config-env alias.n=V n",
      `git ${"-c a=b ".repeat(999)}-c alias.n=x n`,
    ],
    "git clean": [
      "git clean",
      "git clean -f",
      "git clean -xdf",
      "git clean -fen",
      "git clean -fd",
      "{ sudo git clean -fdx; }",
      "for r in a b; do git clean -fd; done",
      "ls\ngit clean -fd",
      "if true; then :; elif git clean -fd; fi",
    ],
    "git reset --hard": [
      "git reset --hard origin/main",
      "if true; then git reset --hard; fi",
      "git reset \\\n  --hard HEAD~1",
      "/usr/bin/git reset --hard",
      "git reset --har",
      "git reset --ha",
      "bash -c 'git reset --hard'",
    ],
    "never `git stash`": [
      "git stash",
      "git stash pop",
      "x=$(git stash)",
      'FOO="a b" git stash',
      "X=$(date +%s) Y=`id` git stash",
      "git -C $(pwd) -C ${HOME}/r stash",
      "if git stash; then :; fi",
      "while git stash; do :; done",
      "! git stash",
      "mise x -C /some/repo -- git stash",
      "mise x node@22 -- git stash",
      "mise x -q python@3.12 npm:oxfmt@0.67 git stash",
      "doas git stash",
      "builtin command git stash",
      "sudo -u me git stash",
      "env -i git stash",
      "nice git stash",
      "time -p git stash",
      "exec -a x git stash",
      "eval git stash",
      'sh -c "git stash"',
      "\\git stash",
      '"git" stash',
      'git -C "/r/my dir" stash',
      "git --git-dir /r/.git stash",
      "git -P stash",
      "git -Z stash",
      "git --no-pager stash",
      "git -c a=b -C '/r/x y' --namespace n --super-prefix s --config-env k=v stash",
      `git ${"-P ".repeat(99)}stash`,
      `find . ${"-exec sudo -u a ".repeat(4000)}git stash`,
    ],
    "never force-push": [
      "git push --force origin x",
      "git push -f",
      "git push --force-with-lease=main",
      "git push -fu origin main",
      "git push origin +main",
      'git push origin "+main"',
      "git push origin '+main:main'",
      "GIT_DIR=/r/.git git push -f",
      'GIT_SSH_COMMAND="ssh -i k" git push -f origin x',
      "A= git push -f",
      "env git push -f",
      "if x; then :; else xargs time nohup exec command git push -f x; fi",
      "git push origin main \\\n  --force",
      "mise x -- git push -f",
      "if true; then git push -f; fi",
      "timeout 5 git push --force",
      "git push --force-w",
      "git push --forc",
      "zsh -c 'git push -f'",
    ],
    "pkill -f matches every process": [
      "pkill -if node",
      "pkill --full node",
      "/usr/bin/pkill -f node",
    ],
  };
  for (const [rule, subjects] of Object.entries(denied))
    for (const subject of subjects) {
      const tool = { YML: "Write", yml: "Edit" }[subject.slice(-3)] ?? "Bash";
      const call = { command: subject, content: "", file_path: subject, tool };
      const { deny } = await $.tool.call(call as any);
      expect(deny).toContain(rule);
      expect(runs.at(-1)?.slice(4, 7)).toEqual([
        "guard",
        "--rationale",
        `${deny.slice(11, -1)}: ${subject.slice(0, 200)}`,
      ]);
    }
  for (const command of [
    "git stash list; git stash show -p; git stash -h; git stash --help; git cleanup",
    "git clean -n; git clean --dry-run -d; git clean -nd",
    "git checkout main; git checkout -b fix; git switch -c fix; git switch main",
    "git switch --force-create x; git restore --staged f; git restore -S .",
    "mise x -C /r -- cargo test",
    "mise x node@22 -- echo git stash",
    "mise x -- echo git stash; sudo -- echo git clean",
    "find . -exec echo git stash {} \\;",
    `${"mise x -q a@b ".repeat(40)}echo hi\n${"sudo -u x@y ".repeat(40)}echo hi`,
    `find . ${"-exec sudo -u a ".repeat(4000)}`,
    "git restore -h; git restore-mtime",
    "git -c color.ui=never status; git -c core.x=y -c aliases.n=x status; git -c x.alias.n=y log",
    "git read-tree HEAD; git read-tree -m HEAD; git read-tree --prefix=u/ HEAD; git read-tree-x -u",
    "git restore --staged --pathspec-from-file=f; git checkout --pathspec-file-nul main",
    `${"mise x -C r -- ".repeat(24)}echo hi\n${"mise x -C r --\n".repeat(24)}echo hi`,
    "git push origin mod",
    "pkill node",
    "git reset HEAD~1",
    'git commit -m "never git stash"',
    "git checkout main\nls -- src",
    "git push origin main\nls -f",
    "git push origin main & ls -f",
    "echo git push -f",
    "git reset HEAD~1\ngrep --hard x",
    "pkill -x node\nls -f",
    "git push --follow-tags --force-if-includes origin main",
    "git --no-pager show stash@{0}",
    "git --no-pager diff stash@{0} -- f",
    "git --no-pager grep clean",
    "git --no-pager log --grep stash",
    `git ${"--a ".repeat(5000)}`,
    `git ${"--git-dir ".repeat(45)}`,
    "git --exec-path /x stash",
    "git reset --h",
    "sudo echo git stash",
    `${"A=x sudo -u env -c k=v ".repeat(2000)}${" ".repeat(9999)}`,
    `git ${"--git-dir=a ".repeat(99)}checkout x`,
    `cat > a.js <<'EOF'\n${";a=b(c)&&d||e;x='".repeat(9999)}\nEOF`,
    "git commit -m 'guard: block `git stash` push'",
    "git commit -F - <<'EOF'\nperpetual: deny `git clean`\nEOF",
    "rg -F '`git stash`' README.md",
    'gh pr create --body "- \\`git reset --hard\\` abbreviations"',
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
