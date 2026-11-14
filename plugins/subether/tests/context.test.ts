import type { On, PromptSubmitInput, RenderSurface } from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

const CAP = 10_000;
const NOW = 1_757_000_000_000;
const SEED =
  'Memory from earlier sessions is yours to pull\n\nalways · about the person, or pinned';
const STATS = 'recall: scorer="pplx" ms=1958\n';
const TIMEOUT = 5000;

/**
The engine beneath: `sandman-next` answering `stdout()`/`exitCode` (rejecting when `isThrown`), on `surfaces`, under
the session id `id()`; each of its runs, the log lines, every prompt that reached the bottom, and each recalls write
*/
const engine = (
  on: On,
  {
    exitCode = 0,
    id = (): string => 's1',
    isThrown = false,
    stdout = (): string => `${SEED}\n`,
    surfaces = ['terminal'] as RenderSurface[],
  } = {},
): {
  logs: string[];
  prompts: PromptSubmitInput[];
  recalls: () => unknown;
  runs: { argv: readonly string[]; stdin?: string; timeoutMs?: number }[];
} => {
  const [logs, prompts, written]: [string[], PromptSubmitInput[], unknown[]] = [[], [], []];
  const runs: { argv: readonly string[]; stdin?: string; timeoutMs?: number }[] = [];
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: '/home/test' });
  on('process.run', ($, e) => {
    const ran = {
      exitCode: 0,
      isStderrTruncated: false,
      isStdoutTruncated: false,
      stderr: '',
      stdout: '',
    };
    if (!String(e.argv[0]).endsWith('sandman-next')) {
      return { value: ran };
    }
    runs.push({ argv: e.argv, stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs });
    return isThrown
      ? { deny: 'timed out' }
      : { value: { ...ran, exitCode, stderr: `${STATS}more`, stdout: stdout() } };
  });
  on('prompt.submit', ($, e) => {
    prompts.push(e);
    return { context: e.context, text: e.text };
  });
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: id() }));
  on('state.set', async ($, e, next) => {
    written.push(...(e.key === 'recalls' ? [e.value] : []));
    return await next(e);
  });
  on('session.surfaces', () => ({ value: surfaces }));
  on('tool.call', ($, e) => ({
    result: '',
    text: String(Reflect.get(e, 'command') ?? Reflect.get(e, 'cue')),
  }));
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { logs, prompts, recalls: () => written.at(-1), runs };
};

const submit = async ($: Engine, extra: Partial<PromptSubmitInput> = {}): Promise<void> => {
  await $.prompt.submit({ origin: { kind: 'composer' }, text: 'hi', wait: false, ...extra });
};

test('the first prompt seeds: sandman-next recall on its stdin, 5 s, stdout attached after what it carried, recorded with stderr', async ($, on) => {
  const { logs, prompts, recalls, runs } = engine(on);
  await submit($, { context: ['earlier'] });
  expect([logs, prompts.map(({ context }) => context), runs]).toEqual([
    [],
    [['earlier', SEED]],
    [
      {
        argv: ['/home/test/.local/bin/sandman-next', 'recall'],
        stdin: '{"cwd":"/w","interactive":true,"prompt":"hi","session":"s1","surface":"terminal"}',
        timeoutMs: TIMEOUT,
      },
    ],
  ]);
  expect(recalls()).toEqual([
    { at: NOW, session: 's1', stderr: `${STATS}more`, text: SEED, who: 'seed' },
  ]);
});

test('later prompts seed nothing; a meta prompt is skipped; a new session id (after /clear) seeds again', async ($, on) => {
  let session = 's1';
  const { prompts, runs } = engine(on, { id: () => session });
  await submit($, { isMeta: true });
  await submit($);
  await submit($);
  session = 's2';
  await submit($);
  expect(prompts.map(({ context }) => context)).toEqual([undefined, [SEED], undefined, [SEED]]);
  expect(runs.map(({ stdin }) => stdin)).toEqual([
    expect.stringContaining('"session":"s1"'),
    expect.stringContaining('"session":"s2"'),
  ]);
});

test('a harness prompt neither seeds nor takes the slot: the next prompt with an ask seeds on its own text', async ($, on) => {
  const { prompts, runs } = engine(on);
  await submit($, {
    origin: { kind: 'task-notification' },
    text: '<task-notification>a1</task-notification>',
  });
  await submit($, { origin: { kind: 'sdk' }, text: 'fix the clock' });
  expect(prompts.map(({ context }) => context)).toEqual([undefined, [SEED]]);
  expect(runs.map(({ stdin }) => stdin)).toEqual([
    expect.stringContaining('"prompt":"fix the clock"'),
  ]);
});

test('a session drawn nowhere (-p) seeds as not interactive, with no surface; nothing printed attaches nothing', async ($, on) => {
  const { logs, prompts, recalls, runs } = engine(on, { stdout: () => ' \n', surfaces: [] });
  await submit($);
  expect([logs, prompts[0]?.context, runs[0]?.stdin]).toEqual([
    [],
    undefined,
    '{"cwd":"/w","interactive":false,"prompt":"hi","session":"s1"}',
  ]);
  expect(recalls()).toEqual([expect.objectContaining({ text: '' })]);
});

test('a seed past the cap is cut at its last line break, named, and logged; with no break, at the cap', async ($, on) => {
  const long = `${'a'.repeat(CAP - 1)}\n${'b'.repeat(CAP)}`;
  let [session, stdout] = ['s1', long];
  const { logs, prompts } = engine(on, { id: () => session, stdout: () => stdout });
  await submit($);
  [session, stdout] = ['s2', 'c'.repeat(CAP + 1)];
  await submit($);
  const reason = `context cap: sandman-next recall printed ${long.length} chars, cap ${CAP}`;
  expect(prompts.map(({ context }) => context?.[0])).toEqual([
    `${'a'.repeat(CAP - 1)}\n… [${reason}]`,
    expect.stringMatching(new RegExp(`^c{${CAP}}… \\[context cap: `, 'u')),
  ]);
  expect(logs[0]).toBe(reason);
});

for (const [name, options, line] of [
  ['a non-zero exit', { exitCode: 2 }, 'Error: exited 2: recall: scorer="pplx" ms=1958'],
  ['a run that rejects', { isThrown: true }, 'HooksError: subether: $.process.run: timed out'],
] as const) {
  test(`${name} attaches nothing, logs one line, is recorded with its error, and is not retried`, async ($, on) => {
    const { logs, prompts, recalls, runs } = engine(on, options);
    await submit($);
    await submit($);
    expect([logs, prompts.map(({ context }) => context), runs.length]).toEqual([
      [`context: sandman-next recall: ${line}`],
      [undefined, undefined],
      1,
    ]);
    expect(recalls()).toEqual([{ at: NOW, error: line, session: 's1', text: '', who: 'seed' }]);
  });
}

test('a pull the agent ran, by Bash or MCP, is kept once its result has a recall header; another Bash call, or a denied one, is not', async ($, on) => {
  const { recalls } = engine(on);
  const pulled = 'sandman-next recall --cue x\nrecall · x · 0 of 3';
  await $.tool.call({ command: pulled, tool: 'Bash' });
  await $.tool.call({ command: 'sandman recall --cue x', tool: 'Bash' });
  await $.tool.call({ command: 'sandman-next recall --cue x; git stash', tool: 'Bash' });
  await $.tool.call({ command: 'cat f\nrecall · x · 0 of 3', tool: 'Bash' });
  await $.tool.call({ cue: 'recall · y · 1 of 3', tool: 'mcp__sandman__recall' });
  expect(recalls()).toEqual([
    { at: NOW, session: 's1', text: pulled, who: 'agent' },
    { at: NOW, session: 's1', text: 'recall · y · 1 of 3', who: 'agent' },
  ]);
});
