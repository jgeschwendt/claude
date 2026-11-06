#!/usr/bin/env bun
// The gate: fmt check, lint, monitor-github's selftest, tsc at the root and in the mod, the unit tests, validate and
// the mod's tests, run at once; each step's output is printed only when it fails, and the exit code is 1 when any did.
const STEPS: Record<string, string[]> = {
  'fmt': ['bun', 'fmt', '--check'],
  'lint': ['bun', '--bun', 'oxlint'],
  'monitor': ['bash', 'skills/monitor-github/scripts/selftest.sh'],
  'test': ['claude', 'plugin', 'test', 'plugins/subether'],
  'tsc': ['bunx', 'tsc', '-p', '.'],
  'tsc:mod': ['bunx', 'tsc', '-p', 'plugins/subether'],
  'unit': ['bun', 'test', './.mise/tasks', './skills'],
  'validate': ['claude', 'plugin', 'validate', 'plugins/subether', '--strict'],
};

const isGreen = async ([name, argv]: [string, string[]]): Promise<boolean> => {
  const step = Bun.spawn(argv, { stderr: 'pipe', stdout: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    step.stdout.text(),
    step.stderr.text(),
    step.exited,
  ]);
  const isOk = code === 0;
  console.log(isOk ? `✔ ${name}` : `✘ ${name}\n${`${stdout}${stderr}`.trimEnd()}`);
  return isOk;
};

const results = await Promise.all(Object.entries(STEPS).map((step) => isGreen(step)));
process.exitCode = results.every(Boolean) ? 0 : 1;
