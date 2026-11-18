// End-to-end checks on the link task, copied into a scratch checkout (it resolves the checkout from its own path) and
// run against a scratch CLAUDE_HOME.
import { expect, test } from 'bun:test';

const rig = async (): Promise<{
  checkout: string;
  home: string;
  link: (...argv: string[]) => Promise<string>;
}> => {
  const root = await Bun.$`realpath $(mktemp -d)`.text();
  const [checkout, home] = [`${root.trim()}/checkout`, `${root.trim()}/home`];
  await Bun.$`mkdir -p ${home} ${checkout}/.mise/tasks && cp ${import.meta.dir}/link ${checkout}/.mise/tasks/`;
  const link = async (...argv: string[]): Promise<string> => {
    const environment = { ...process.env, CLAUDE_HOME: home };
    const run = await Bun.$`${checkout}/.mise/tasks/link ${argv}`
      .env(environment)
      .nothrow()
      .quiet();
    return `${run.exitCode}\n${run.stdout.toString()}`;
  };
  return { checkout, home, link };
};

// A home linked throughout passes the check.
test('a linked home is ok', async () => {
  const { checkout, home, link } = await rig();
  const entries = [
    'rules',
    'skills',
    'workflows',
    'CLAUDE.md',
    'settings.json',
    'settings.local.json',
  ];
  await Promise.all(entries.map((entry) => Bun.$`ln -s ${checkout}/${entry} ${home}/${entry}`));
  expect(await link('--check')).toBe(
    ['0', ...entries.map((entry) => `ok: ${entry}`), ''].join('\n'),
  );
});

/**
The link output, behind its exit code, for a home whose missing entries read `missing` and stale links `stale`
*/
const lines = (missing: string, stale: string): string =>
  [
    1,
    'drift: rules',
    `${missing}: skills`,
    `${missing}: workflows`,
    'drift: CLAUDE.md',
    'ok: settings.json',
    `${missing}: settings.local.json`,
    `${stale}: gone`,
    '',
  ].join('\n');

// A real file or a foreign link is `drift` and left alone in either mode; `--check` only reports a missing entry or a
// stale link into the checkout, which a plain run links or removes; any other argument is usage.
test('links missing entries and never overwrites', async () => {
  const { checkout, home, link } = await rig();
  await Bun.write(`${home}/CLAUDE.md`, 'mine');
  await Bun.$`ln -s /elsewhere ${home}/rules && ln -s ${checkout}/settings.json ${home}/settings.json && ln -s ${checkout}/gone ${home}/gone`;
  expect(await link('--check')).toBe(lines('missing', 'stale'));
  expect(await link()).toBe(lines('link', 'unlink'));
  const after = Bun.$`test ! -L ${home}/gone && cat ${home}/CLAUDE.md && echo && readlink ${home}/rules ${home}/skills`;
  expect(await after.text()).toBe(`mine\n/elsewhere\n${checkout}/skills\n`);
  expect(await link('-x')).toBe('2\n');
});
