// The whole loop in a real browser against the real hud, where both exist (skipped elsewhere, CI included): choose,
// write and Send; `show wait` sees it; a reply lands on the card with no reload; resolve collapses it; a restart
// keeps it all; and the console stays clean.
import { afterAll, expect, test } from 'bun:test';
import { hudPath, run } from './cli.ts';

const { existsSync, mkdtempSync } = process.getBuiltinModule('node:fs');

const DIR = import.meta.dir;
/**
how long the whole loop may take, two daemon boots and a browser included
*/
const LIMIT_MS = 60_000;
/**
how often, and how many times, a condition is looked for
*/
const POLL_MS = 100;
const TRIES = 100;
const SHOW_HUD = hudPath();
const BROWSER = String(Bun.which('agent-browser'));
const SESSION = `show-test-${process.pid}`;
const root = mkdtempSync('/tmp/show-');
const children: Bun.Subprocess[] = [];
Object.assign(Bun.env, { SHOW_NO_BROWSER: '1', XDG_STATE_HOME: root });

const browse = (...argv: string[]): string =>
  Bun.spawnSync([BROWSER, ...argv], { env: { ...process.env, AGENT_BROWSER_SESSION: SESSION } })
    .stdout.toString()
    .trim();
const until = async (isMet: () => boolean, tries = 0): Promise<void> => {
  if (isMet()) {
    return;
  }
  expect(tries).toBeLessThan(TRIES);
  await Bun.sleep(POLL_MS);
  await until(isMet, tries + 1);
};
const start = async (port: number): Promise<Bun.Subprocess> => {
  const child = Bun.spawn([process.execPath, `${DIR}/show`, 'serve'], {
    env: { ...process.env, SHOW_HUD, SHOW_PORT: String(port) },
  });
  children.push(child);
  await until(() => Bun.spawnSync([`${DIR}/show`, 'health'], { env: process.env }).exitCode === 0);
  return child;
};
const said = async (...argv: string[]): Promise<string> => {
  const [code, text] = await run(argv);
  expect(code).toBe(0);
  return text;
};

afterAll(() => {
  for (const child of children) {
    child.kill('SIGKILL');
    browse('close');
  }
});

test.skipIf(!Bun.which('agent-browser') || !existsSync(SHOW_HUD))(
  'a Send, a reply, a resolve and a restart in a real browser',
  async () => {
    const probe = Bun.serve({ fetch: () => new Response(), port: 0 });
    const port = Number(probe.port);
    await probe.stop(true);
    const first = await start(port);
    browse('open', await said('open', `${DIR}/example.json`));
    browse('set', 'viewport', '420', '900');
    await until(() => browse('eval', 'Boolean(document.querySelector("hud"))') === 'true');
    browse('click', '#card-land input[value=hold]');
    browse('fill', '#card-land textarea', 'look first');
    browse('click', '#card-land button[value=answer]');
    expect(JSON.parse(await said('wait', 'lints-canon'))).toMatchObject({
      card: 'land',
      choice: 'hold',
      kind: 'answer',
      message: 'look first',
    });
    await until(() =>
      browse('get', 'text', '#card-land .thread').includes('hold, I want to look — look first'),
    );
    await said('reply', 'lints-canon', 'land', 'holding until you have looked');
    await until(() =>
      browse('get', 'text', '#card-land .thread').includes('holding until you have looked'),
    );
    await said('resolve', 'lints-canon', 'land');
    await until(() =>
      browse('get', 'text', '.resolved').includes('jlg.io harness · hold, I want to look'),
    );
    first.kill('SIGTERM');
    expect(await first.exited).toBe(0);
    await start(port);
    await said('status', 'lints-canon', 'back after a restart');
    await until(() => browse('get', 'text', '.standing').includes('back after a restart'));
    expect(browse('get', 'text', '.resolved')).toContain('jlg.io harness');
    expect(browse('errors')).toBe('');
    expect(browse('console')).not.toMatch(/error/iu);
  },
  LIMIT_MS,
);
