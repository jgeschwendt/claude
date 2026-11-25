#!/usr/bin/env bun
// The gate: the chart data against the source, fmt check, lint, tsc at the root, in the mod and in show, the unit
// tests, show's tests under its bunfig.toml's 100 % coverage threshold, validate and the mod's tests, run at once;
// each step's output is printed only when it fails, and the exit code is 1 when any did. The mod's tsc and its senses
// survey need the declarations the engine writes into the mod's `.claude-plugin/types/` when an interactive session
// loads it (no command writes them), so a checkout no session has loaded, CI's among them, skips those two and says so. validate is not `--strict`: its warnings (no icon) do
// not fail the gate.
// a gate inside a gate is a step that resolved to the `test` script: it froze the machine twice
const { GATE } = Bun.env;
if (GATE) {
  console.error('gate: refusing to run inside itself: `bun --cwd <dir> test` is `bun run test`');
  process.exit(1);
}

const STEPS: Record<string, string[]> = {
  'docs': ['bun', 'scripts/charts.ts'],
  'fmt': ['bun', 'fmt', '--check'],
  'lint': ['bun', '--bun', 'oxlint'],
  'senses': ['bun', 'test', './plugins/subether/senses'],
  // `test` leads: `bun --cwd <dir> test` runs the `test` script, this gate, forking without end
  'show': ['bun', 'test', '--coverage', '--cwd', 'skills/show'],
  'test': ['claude', 'plugin', 'test', 'plugins/subether'],
  'tsc': ['bunx', 'tsc', '-p', '.'],
  'tsc:mod': ['bunx', 'tsc', '-p', 'plugins/subether'],
  'tsc:show': ['bunx', 'tsc', '-p', 'skills/show'],
  'unit': ['bun', 'test', '--path-ignore-patterns=skills/show/**', './.mise/tasks', './skills'],
  'validate': ['claude', 'plugin', 'validate', 'plugins/subether'],
};

const isGreen = async ([name, argv]: [string, string[]]): Promise<boolean> => {
  const step = Bun.spawn(argv, { env: { ...Bun.env, GATE: '1' }, stderr: 'pipe', stdout: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    step.stdout.text(),
    step.stderr.text(),
    step.exited,
  ]);
  const isOk = code === 0;
  console.log(isOk ? `✔ ${name}` : `✘ ${name}\n${`${stdout}${stderr}`.trimEnd()}`);
  return isOk;
};

const hasTypes = await Bun.file(
  'plugins/subether/.claude-plugin/types/claude-code/index.d.ts',
).exists();
if (!hasTypes) {
  console.log('– senses and tsc:mod skipped: no engine-written types in this checkout');
}
const steps = Object.entries(STEPS).filter(
  ([name]) => hasTypes || !['senses', 'tsc:mod'].includes(name),
);
const results = await Promise.all(steps.map((step) => isGreen(step)));
process.exitCode = results.every(Boolean) ? 0 : 1;
