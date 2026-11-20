// End-to-end checks on the link task, copied into a scratch Git checkout (it resolves the checkout from its own path)
// with one item of each kind, and run against a scratch CLAUDE_HOME.
import { expect, test } from 'bun:test';

const rig = async (): Promise<{
  checkout: string;
  home: string;
  link: (...argv: string[]) => Promise<string>;
  tree: () => Promise<string>;
}> => {
  const root = await Bun.$`realpath $(mktemp -d)`.text();
  const [checkout, home] = [`${root.trim()}/checkout`, `${root.trim()}/home`];
  await Bun.$`mkdir -p ${home} ${checkout}/.mise/tasks ${checkout}/rules ${checkout}/skills/s ${checkout}/skills/synced ${checkout}/workflows ${checkout}/user && cp ${import.meta.dir}/link ${checkout}/.mise/tasks/`;
  await Promise.all(
    [
      '.gitignore',
      'rules/a.md',
      'skills/s/SKILL.md',
      'skills/s/x.log',
      'skills/synced/x',
      'user/CLAUDE.md',
      'user/settings.json',
      'workflows/w.js',
    ].map((path) =>
      Bun.write(`${checkout}/${path}`, path === '.gitignore' ? '*.log\nskills/synced/\n' : ''),
    ),
  );
  await Bun.$`git -C ${checkout} init -q`;
  const link = async (...argv: string[]): Promise<string> => {
    const run = await Bun.$`${checkout}/.mise/tasks/link ${argv}`
      .env({ ...process.env, CLAUDE_HOME: home })
      .nothrow()
      .quiet();
    return `${run.exitCode}\n${run.stdout.toString()}`;
  };
  const tree = (): Promise<string> =>
    Bun.$`find ${home} ${checkout}/skills -exec sh -c 'echo "$0 -> $(readlink "$0")"' {} ';' | sort`.text();
  return { checkout, home, link, tree };
};

/**
The link output: the exit code, then one line per report
*/
const out = (code: number, ...lines: string[]): string => [code, ...lines, ''].join('\n');

// A fresh home: `--check` reports every item missing and creates nothing; a plain run makes the three directories and
// links each item (the git-ignored skills/synced not among them); then all is ok; any other argument is usage.
test('links a fresh home', async () => {
  const { checkout, home, link, tree } = await rig();
  const items = ['rules/a.md', 'skills/s', 'workflows/w.js', 'CLAUDE.md', 'settings.json'];
  const before = await tree();
  expect(await link('--check')).toBe(out(1, ...items.map((item) => `missing: ${item}`)));
  expect(await tree()).toBe(before);
  expect(await link()).toBe(out(0, ...items.map((item) => `link: ${item}`)));
  expect(await link('--check')).toBe(out(0, ...items.map((item) => `ok: ${item}`)));
  expect(
    await Bun.$`test ! -L ${home}/rules && readlink ${home}/skills/s ${home}/CLAUDE.md`.text(),
  ).toBe(`${checkout}/skills/s\n${checkout}/user/CLAUDE.md\n`);
  expect(await link('-x')).toBe('2\n');
});

/**
The output for a home holding foreign items, a moved link and orphans, with `fix` and `prune` the verbs for a link
re-pointed and a link removed
*/
const foreign = (fix: string, prune: string): string =>
  out(
    1,
    'drift: workflows',
    'drift: rules/a.md',
    'drift: skills/s',
    'drift: CLAUDE.md',
    `${fix}: settings.json`,
    `${prune}: settings.local.json`,
    `${prune}: rules/gone.md`,
  );

// A real file, real directory or foreign link — at an item or at a parent directory, whose items it then skips — is
// `drift` and left alone; another setup's rule is not reported; a link into the checkout at a moved path is re-pointed
// and one no item claims is removed, at the top level and inside a directory.
test('never overwrites', async () => {
  const { checkout, home, link, tree } = await rig();
  await Bun.$`mkdir -p ${home}/rules ${home}/skills/s && echo mine > ${home}/rules/a.md && touch ${home}/rules/other.md`;
  await Bun.$`ln -s /elsewhere ${home}/workflows && ln -s /elsewhere ${home}/CLAUDE.md && ln -s ${checkout}/old.json ${home}/settings.json && ln -s ${checkout}/settings.local.json ${home}/settings.local.json && ln -s ${checkout}/rules/gone.md ${home}/rules/gone.md`;
  const before = await tree();
  expect(await link('--check')).toBe(foreign('stale', 'stale'));
  expect(await tree()).toBe(before);
  expect(await link()).toBe(foreign('link', 'unlink'));
  expect(await tree()).toBe(
    before
      .replace(`${checkout}/old.json`, () => `${checkout}/user/settings.json`)
      .replaceAll(/^.*(?:gone|local).*\n/gmu, ''),
  );
  expect(await Bun.file(`${home}/rules/a.md`).text()).toBe('mine\n');
});

// The old layout's whole-directory links into the checkout are `stale` to `--check`; a plain run makes each a real
// directory, moving the checkout's git-ignored skills/synced into it, and links the items; a parent that is a real
// file is `drift`.
test('converts whole-directory links', async () => {
  const { checkout, home, link, tree } = await rig();
  await Bun.$`ln -s ${checkout}/rules ${home}/rules && ln -s ${checkout}/skills ${home}/skills && echo mine > ${home}/workflows`;
  const before = await tree();
  expect(await link('--check')).toBe(
    out(
      1,
      'stale: rules',
      'stale: skills',
      'drift: workflows',
      'missing: CLAUDE.md',
      'missing: settings.json',
    ),
  );
  expect(await tree()).toBe(before);
  expect(await link()).toBe(
    out(
      1,
      'unlink: rules',
      'unlink: skills',
      'move: skills/synced',
      'drift: workflows',
      'link: rules/a.md',
      'link: skills/s',
      'link: CLAUDE.md',
      'link: settings.json',
    ),
  );
  const after = Bun.$`test ! -L ${home}/rules && test ! -L ${home}/skills/synced && test ! -e ${checkout}/skills/synced && ls ${home}/skills/synced && cat ${home}/workflows`;
  expect(await after.text()).toBe('x\nmine\n');
});
