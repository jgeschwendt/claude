// The daemon's lifecycle against the real process (`show serve`): one instance by lock, SIGTERM drains and exits 0,
// a kill -9 leaves stale files a restart recovers from, and a version mismatch is named. The CLI runs in this
// process, so its side counts toward coverage.
import { afterAll, expect, test } from 'bun:test';
import { unknown as anything, parse, record } from 'verax';
import { run } from './cli.ts';

const { existsSync, mkdtempSync, readFileSync, writeFileSync } =
  process.getBuiltinModule('node:fs');

/**
how long a drain may take before the daemon is called slow
*/
const DRAIN_BUDGET_MS = 5000;
const DIR = import.meta.dir;
/**
how often a starting daemon is asked whether it is ready
*/
const POLL_MS = 50;
const spawned: Bun.Subprocess[] = [];
Object.assign(Bun.env, { SHOW_NO_BROWSER: '1' });

/**
what a daemon answers on its health route, or nothing while it is not up
*/
const ask = async (root: string): Promise<Record<string, unknown>> => {
  try {
    const response = await fetch('http://show/health', { unix: `${root}/show/show.sock` });
    return parse(await response.json(), record(anything()));
  } catch {
    return {};
  }
};
/**
wait until the daemon on `root` reports ready, and give its health
*/
const ready = async (root: string): Promise<Record<string, unknown>> => {
  const health = await ask(root);
  const { state } = health;
  if (state === 'ready') {
    return health;
  }
  await Bun.sleep(POLL_MS);
  return ready(root);
};
/**
a `show serve` child on `root`, and its health once it answers
*/
const start = async (
  root: string,
  extra: Record<string, string> = {},
): Promise<[Bun.Subprocess<'ignore', 'pipe', 'pipe'>, Record<string, unknown>]> => {
  const child = Bun.spawn([process.execPath, `${DIR}/show`, 'serve'], {
    env: {
      ...process.env,
      SHOW_HUD: `${DIR}/fake-hud.ts`,
      SHOW_PORT: '0',
      XDG_STATE_HOME: root,
      ...extra,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  spawned.push(child);
  Object.assign(Bun.env, { XDG_STATE_HOME: root });
  return [child, await ready(root)];
};

afterAll(() => {
  for (const child of spawned) {
    child.kill('SIGKILL');
  }
});

test('one instance; SIGTERM drains and exits 0; a kill -9 is recovered from', async () => {
  const root = mkdtempSync('/tmp/show-');
  const [first] = await start(root);
  const second = Bun.spawn([process.execPath, `${DIR}/show`, 'serve'], {
    env: { ...process.env, SHOW_HUD: `${DIR}/fake-hud.ts`, SHOW_PORT: '0', XDG_STATE_HOME: root },
    stderr: 'pipe',
  });
  const refusal = new Response(second.stderr);
  expect([await second.exited, await refusal.text()]).toEqual([
    1,
    `show: running: another show holds ${root}/show/show.lock (pid ${first.pid})\n`,
  ]);
  // one plan with no code or machine: a lifecycle test pays for no grammar or layout on each boot
  writeFileSync(
    `${root}/plan.json`,
    JSON.stringify([
      'Lifecycle',
      [['note', { text: 'n' }]],
      { go: ['Go?', [['choice', { id: 'go', options: { yes: { label: 'yes', lean: true } } }]]] },
    ]),
  );
  const [opened] = await run(['open', `${root}/plan.json`]);
  expect(opened).toBe(0);
  const began = Date.now();
  first.kill('SIGTERM');
  expect(await first.exited).toBe(0);
  expect(Date.now() - began).toBeLessThan(DRAIN_BUDGET_MS);
  expect(readFileSync(`${root}/show/show.log`, 'utf8')).toMatch(
    /start \w+ pid \d+\n.*ready http:\/\/127\.0\.0\.1:\d+\/\n.*open lifecycle\n.*exit SIGTERM\n$/u,
  );
  const [killed] = await start(root);
  killed.kill('SIGKILL');
  await killed.exited;
  expect(existsSync(`${root}/show/show.sock`)).toBe(true);
  const [, health] = await start(root);
  expect(health['state']).toBe('ready');
  const [, listing] = await run(['list']);
  expect(listing).toContain('Lifecycle · 1 his turn');
});

test('a daemon on another version is named, with the fix', async () => {
  await start(mkdtempSync('/tmp/show-'), { SHOW_VERSION: 'old' });
  expect<unknown[]>(await run(['health'])).toEqual([
    1,
    expect.stringMatching(
      /^show: version: daemon runs old, this CLI is \w+: restart the daemon: launchctl kickstart -k gui\/\d+\/io\.jlg\.show, or `show setup` if the job is not installed$/u,
    ),
  ]);
  expect<unknown[]>(await run(['list'])).toEqual([
    1,
    expect.stringMatching(/^show: version: daemon runs old, this CLI is \w+/u),
  ]);
});
