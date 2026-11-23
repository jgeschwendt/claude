import { expect, spyOn, test } from 'bun:test';
import { drift, main, offer, reads, survey } from './survey';

const HOME = `${import.meta.dir}/../`;

/**
engine types: two engine events census hooks, one it does not, one carrying a tool's arguments, one classic event and
one call on `$`
*/
const TYPES = `// Written by Claude Code 9.9.9.
declare module 'claude-code' {
  export type ClassicEventOf = { 'classic.Gone': { z: string } };
  export type EngineEventOf = {
    'ev.idle': { k: string };
    'ev.one': { a: string; c?: string } | { b: number };
    'ev.two': { a: string; d: string };
    'tool.call': { arg: string; tool: 'A'; x: string } | { [key: string]: unknown; tool: 'B'; x: string };
  };
  export type OpEventOf = { 'fs.read': { path: string } };
}
`;

/**
A scratch mod holding `types` beside census hooks that read every way the survey knows and `register` binding them
*/
const scratch = async (types = TYPES): Promise<string> => {
  const home = `/tmp/senses-${crypto.randomUUID()}/`;
  await Bun.write(`${home}.claude-plugin/types/claude-code/index.d.ts`, types);
  await Bun.write(
    `${home}hooks/census.ts`,
    `let unset;
const count = 1;
const helper = (only) => only;
const unbound = ($, e) => e.q;
const shared = async ($, e, next) => {
  const { a, b: renamed } = e;
  const other = { e: 1 };
  field(e, 'c');
  field(e, key);
  e.ghost;
  other.e;
  return await next(e);
};
const plain = function ($, e) {
  return e.x;
};
`,
  );
  await Bun.write(
    `${home}hooks/register.tsx`,
    `on('ev.one', shared);
on('ev.two', {}, shared);
on('tool.call', plain);
on('ev.one', helper);
`,
  );
  await Bun.write(
    `${home}hooks/senses.ts`,
    "export const senses = { undeclared: { 'classic.*': ['seen'] } };\n",
  );
  return home;
};

/**
`main` run with what it prints caught: its code and the lines, sorted
*/
const quietly = async (argv: string[], home: string): Promise<[number, string[]]> => {
  const print = spyOn(process.stdout, 'write').mockImplementation(() => true);
  const code = await main(argv, home);
  const lines = print.mock.calls.flatMap(([text]) => String(text).split('\n').filter(Boolean));
  print.mockRestore();
  return [code, lines.toSorted((left, right) => left.localeCompare(right))];
};

test('the manifest is the surface the live types offer, read as census.ts reads it', async () => {
  const { senses } = (await import(`${HOME}hooks/senses.ts`)) as {
    senses: Parameters<typeof drift>[0];
  };
  const { ghosts, manifest } = survey(
    await offer(`${HOME}.claude-plugin/types`),
    await reads(`${HOME}hooks`),
    senses.undeclared,
  );
  expect([...drift(senses, manifest), ...ghosts]).toEqual([]);
});

test('the command line surveys the mod it sits in, its code the exit code', async () => {
  const before = process.exitCode;
  await import('./cli');
  expect(process.exitCode).toBe(0);
  process.exitCode = before;
});

test("each bound census hook's reads are what it reads of its second parameter", async () => {
  expect(await reads(`${await scratch()}hooks`)).toEqual({
    helper: { events: ['ev.one'], fields: [] },
    plain: { events: ['tool.call'], fields: ['x'] },
    shared: { events: ['ev.one', 'ev.two'], fields: ['a', 'b', 'c', 'ghost'] },
  });
});

test('the surface is each event by field, an open one by its envelope, the calls on `$` by name', async () => {
  expect(await offer(`${await scratch()}.claude-plugin/types`)).toEqual({
    events: {
      'classic.Gone': { fields: ['z'], open: false },
      'ev.idle': { fields: ['k'], open: false },
      'ev.one': { fields: ['a', 'b', 'c'], open: false },
      'ev.two': { fields: ['a', 'd'], open: false },
      'tool.call': { fields: ['tool', 'x'], open: true },
    },
    ops: ['fs.read'],
    version: '9.9.9',
  });
  const unversioned = await scratch(TYPES.slice(TYPES.indexOf('\n')));
  const { version } = await offer(`${unversioned}.claude-plugin/types`);
  expect(version).toBe('');
});

test('--write records the survey, a read none of its events offers still failing it', async () => {
  const home = await scratch();
  expect(await quietly(['--write'], home)).toEqual([
    1,
    ["! census's shared reads ghost, which none of ev.one, ev.two offers"],
  ]);
  expect(((await import(`${home}hooks/senses.ts`)) as { senses: unknown }).senses).toEqual({
    args: ['tool.call'],
    events: {
      'ev.one': { read: ['a', 'b', 'c'], unread: [] },
      'ev.two': { read: ['a'], unread: ['d'] },
      'tool.call': { read: ['x'], unread: ['tool'] },
    },
    ops: ['fs.read'],
    undeclared: { 'classic.*': ['seen'] },
    unsubscribed: { 'classic.Gone': ['z'], 'ev.idle': ['k'] },
    version: '9.9.9',
  });
});

test('a bare survey prints each fact gained or lost', async () => {
  const home = await scratch();
  await quietly(['--write'], home);
  await Bun.write(
    `${home}.claude-plugin/types/claude-code/index.d.ts`,
    `// Written by Claude Code 9.9.10.
declare module 'claude-code' {
  export type ClassicEventOf = { 'classic.New': { z: string } };
  export type EngineEventOf = {
    'ev.one': { a: string; c?: string; ghost: string } | { b: number };
    'ev.two': { a: string };
    'tool.call': { [key: string]: unknown; tool: string; x: string };
  };
  export type OpEventOf = { 'fs.read': { path: string }; 'fs.walk': { path: string } };
}
`,
  );
  expect(await quietly([], home)).toEqual([
    1,
    [
      '+ event classic.New',
      '+ field classic.New z',
      '+ field ev.one ghost',
      '+ op fs.walk',
      '+ read ev.one ghost',
      '+ version 9.9.10',
      '- event classic.Gone',
      '- event ev.idle',
      '- field classic.Gone z',
      '- field ev.idle k',
      '- field ev.two d',
      '- version 9.9.9',
    ].toSorted((left, right) => left.localeCompare(right)),
  ]);
});
