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
const NOW = Date.UTC(2026, 9, 9, 12, 0);
const SANDMAN = `${HOME}/.local/bin/sandman`;
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

/**
 * Stubs the engine beneath the mod: env, clock, files, processes, logs, session.
 * Returns the argv of every `$.process.run`, each path read and each `$.ui.log` text.
 */
function world(
  on: On,
  files: Record<string, string>,
  { env = {}, isRunDenied = false, stdout = '' }: { env?: Record<string, string>; isRunDenied?: boolean; stdout?: string } = {},
) {
  const runs: string[][] = [];
  const logs: string[] = [];
  const reads: string[] = [];
  mock.env(on, { HOME, ...env })
  mock.clock(on, { now: NOW });
  on("command.register", () => ({ value: undefined }));
  on("fs.read", ($, e) => {
    reads.push(e.path);
    const text = files[e.path];
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on("process.run", ($, e) => {
    runs.push([...e.argv])
    if (isRunDenied) return { deny: 'spawn ENOENT' }
    return { value: { exitCode: 0, stderr: "", stdout } };
  });
  on("prompt.submit", ($, e) => ({ text: e.text }));
  on("session.id", () => ({ value: "sess-1" }));
  on("session.start", () => ({ cwd: "/work" }));
  on("ui.log", ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on("ui.render", () => ({ children: ["engine"], props: {}, type: "Text" }));
  return { logs, reads, runs };
}

const submit = ($: any, text: string, origin: object = { kind: "composer" }) =>
  $.prompt.submit({ origin, text, wait: false });

const start = ($: any, isInteractive = true) =>
  $.session.start({ cwd: "/work", isInteractive, surface: isInteractive ? "terminal" : null });

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

test("band truncates to the body width", async ($, on) => {
  world(on, { [`${HOME}/.sandman/shifts/current.json`]: JSON.stringify(SHIFT) });
  await start($);
  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 20 },
    surface: "terminal",
  });
  const band = await ui.find({ type: "Text", text: /^⟳/ });
  expect(band?.text).toHaveLength(20);
  expect(band?.text).toEndWith("…");
  await ui.unmount();
});

test("band draws nothing without shift or trail files", async ($, on) => {
  world(on, {});
  await start($);
  const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /^⟳/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "engine" })).toBeDefined();
  await ui.unmount();
});

test("a correction prompt appends a correction to the trail", async ($, on) => {
  const { runs } = world(on, {});
  const out = await submit($, "No, don't stash in the shared tree");
  expect(out).toEqual({ text: "No, don't stash in the shared tree" });
  expect(runs).toEqual([
    [
      SANDMAN,
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

test("a plain prompt appends nothing", async ($, on) => {
  const { runs } = world(on, {});
  const out = await submit($, "add a band above the prompt");
  expect(out).toEqual({ text: "add a band above the prompt" });
  expect(runs).toEqual([]);
});

test("a prompt not typed at the composer is ignored", async ($, on) => {
  const { runs } = world(on, {});
  await submit($, "stop everything", { kind: "plugin", name: "other" });
  await submit($, "never mind that", { kind: "task-notification" });
  expect(runs).toEqual([]);
});

test("a repeated prompt is flagged as a repeated instruction", async ($, on) => {
  const { runs } = world(on, {});
  await submit($, "pin every agent spawn to opus explicitly");
  expect(runs).toEqual([]);
  await submit($, "Pin every agent spawn to Opus, explicitly!");
  expect(runs).toHaveLength(1);
  expect(runs[0]?.[6]).toBe("repeated instruction: Pin every agent spawn to Opus, explicitly!");
});

test("a failed sandman call is logged and the prompt goes on", async ($, on) => {
  const { logs } = world(on, {}, { isRunDenied: true });
  const out = await submit($, "stop that");
  expect(out).toEqual({ text: "stop that" });
  expect(logs.join("\n")).toMatch(/sandman trail append failed/);
});

test("headless: capture runs and the band reads nothing", async ($, on) => {
  const { reads, runs } = world(on, {
    [`${HOME}/.sandman/shifts/current.json`]: JSON.stringify(SHIFT),
  });
  await start($, false);
  expect(reads).toEqual([]);
  await submit($, "never do that again", { kind: "sdk" });
  expect(runs.map((argv) => argv.slice(0, 3))).toEqual([[SANDMAN, "trail", "append"]]);
});

test("/trail 5 logs the last five trail lines and answers nothing", async ($, on) => {
  const lines = Array.from({ length: 12 }, (_, i) => `event ${i + 1}`).join("\n");
  const { logs, runs } = world(on, {}, { stdout: lines + "\n" });
  await start($);
  const out = await $.command.run({
    args: "5",
    command: "trail",
    origin: { kind: "composer" },
    presentation: { columns: 120, isFullscreen: true },
  });
  expect(out).toEqual({});
  expect(runs).toEqual([[SANDMAN, "trail", "log"]]);
  expect(logs).toEqual(["event 8\nevent 9\nevent 10\nevent 11\nevent 12"]);
});

test("/shift logs sandman shift status and answers nothing", async ($, on) => {
  const { logs, runs } = world(on, {}, { stdout: "shift bootstrap-2026-10-09\n" });
  await start($);
  const out = await $.command.run({
    args: "",
    command: "shift",
    origin: { kind: "composer" },
    presentation: { columns: 120, isFullscreen: true },
  });
  expect(out).toEqual({});
  expect(runs).toEqual([[SANDMAN, "shift", "status"]]);
  expect(logs).toEqual(["shift bootstrap-2026-10-09"]);
});
