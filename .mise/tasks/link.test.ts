// End-to-end checks on the link task, copied into a scratch checkout (it resolves the checkout from its own path, so
// the trunk's plugin.json is the scratch one) and run against a scratch CLAUDE_HOME.
import { expect, test } from 'bun:test';

const rig = async (): Promise<{
  checkout: string;
  home: string;
  link: (...argv: string[]) => Promise<string>;
}> => {
  const root = await Bun.$`realpath $(mktemp -d)`.text();
  const [checkout, home] = [`${root.trim()}/checkout`, `${root.trim()}/home`];
  await Bun.$`mkdir -p ${home}/plugins ${checkout}/.mise/tasks && cp ${import.meta.dir}/link ${checkout}/.mise/tasks/`;
  await Bun.write(
    `${checkout}/plugins/perpetual/.claude-plugin/plugin.json`,
    '{ "version": "1.0.0" }',
  );
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

// The perpetual line is `ok` only while every user-scope copy is the trunk's version, whatever a project-scope copy
// holds; an older, newer or missing install fails the check and names its fix.
test.each([
  [['1.0.0'], 0, 'ok: perpetual 1.0.0'],
  [['1.0.0', '1.0.0'], 0, 'ok: perpetual 1.0.0'],
  [
    ['0.0.1'],
    1,
    'differs: perpetual 0.0.1 ≠ trunk 1.0.0 (claude plugin update perpetual@jgeschwendt)',
  ],
  [
    ['99.0.0'],
    1,
    'differs: perpetual 99.0.0 ≠ trunk 1.0.0 (claude plugin update perpetual@jgeschwendt)',
  ],
  [[], 1, 'missing: perpetual (claude plugin install perpetual@jgeschwendt)'],
])('perpetual installed at %p', async (installed, code, line) => {
  const { checkout, home, link } = await rig();
  const entries = ['rules', 'skills', 'CLAUDE.md', 'settings.json', 'settings.local.json'];
  await Promise.all(
    entries.map(async (entry) => {
      await Bun.$`ln -s ${checkout}/${entry} ${home}/${entry}`;
    }),
  );
  const scopes = [
    { scope: 'project', version: '0.0.0' },
    ...installed.map((version) => ({ scope: 'user', version })),
  ];
  const plugins = { 'perpetual@jgeschwendt': scopes };
  await Bun.write(`${home}/plugins/installed_plugins.json`, JSON.stringify({ plugins }));
  const ok = entries.map((entry) => `ok: ${entry}`);
  expect(await link('--check')).toBe([code, ...ok, line, ''].join('\n'));
});

/**
The link output, behind its exit code, for a home whose missing entries read `missing` and stale links `stale`
*/
const lines = (missing: string, stale: string): string =>
  [
    1,
    'drift: rules',
    `${missing}: skills`,
    'drift: CLAUDE.md',
    'ok: settings.json',
    `${missing}: settings.local.json`,
    `${stale}: gone`,
    'missing: perpetual (claude plugin install perpetual@jgeschwendt)',
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
