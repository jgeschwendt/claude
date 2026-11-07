import type { On, ToolCallResult } from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

/**
A typed fixture from JSON, which keeps the environment's names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;

/**
early on 2026-11-07 UTC, still 2026-11-06 in every zone west of Greenwich: the file is named by the local day
*/
const AT = '2026-11-07T03:30:00.250Z';
const NOW = Temporal.Instant.from(AT).epochMilliseconds;
const CUT = 2000;
const EXTRA = 5;
const SCRIPT = 'mkdir -p "$(dirname "$1")" && cat >> "$1"';
const TOOK = 25;
const DAY = Temporal.Instant.fromEpochMilliseconds(NOW)
  .toZonedDateTimeISO(Temporal.Now.timeZoneId())
  .toPlainDate()
  .toString();

/**
The engine beneath: the tool answering `answer` once the clock moved `TOOK` ms, the append answering `exitCode` (or refusing to
start), each append's argv and line, the log
*/
const engine = (
  on: On,
  {
    answer = { result: 'ran', text: 'ran' } as ToolCallResult,
    environment = fixture<Record<string, string>>(
      '{"CLAUDE_TOOL_LOG_DIR":"/logs","HOME":"/home/test"}',
    ),
    exitCode = 0,
    isRefused = false,
  } = {},
): {
  appends: { argv: readonly string[]; line?: string }[];
  logs: string[];
  time: ReturnType<typeof mock.clock>;
} => {
  const appends: { argv: readonly string[]; line?: string }[] = [];
  const logs: string[] = [];
  const time = mock.clock(on, { now: NOW });
  mock.env(on, environment);
  on('process.run', ($, e) => {
    const ran = {
      exitCode: 0,
      isStderrTruncated: false,
      isStdoutTruncated: false,
      stderr: '',
      stdout: '',
    };
    if (e.argv[0] !== '/bin/sh') {
      return { value: ran };
    }
    appends.push({ argv: e.argv, line: e.init?.stdin });
    return isRefused
      ? { deny: 'spawn ENOENT' }
      : { value: { ...ran, exitCode, stderr: 'read-only\n' } };
  });
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: 's1' }));
  on('tool.call', async () => {
    await time.advance(TOOK);
    return answer;
  });
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { appends, logs, time };
};

/**
One call, the append left to land
*/
const call = async (
  $: Engine,
  time: ReturnType<typeof mock.clock>,
  input: Parameters<Engine['tool']['call']>[0],
): Promise<unknown> => {
  const result = await $.tool.call(input);
  await time.settle();
  return result;
};

const lines = (appends: { line?: string }[]): unknown[] =>
  appends.map(({ line = '' }) => JSON.parse(line));

test('a call appends one line, keys in wire order, to the local day’s file', async ($, on) => {
  const { appends, time } = engine(on, {
    answer: { isReadOnly: true, result: { file: {} }, text: 'three' },
  });
  await call($, time, { file_path: '/w/a.md', tool: 'Read', tool_use_id: 'tu1' });
  expect(appends).toEqual([
    {
      argv: ['/bin/sh', '-c', SCRIPT, '_', `/logs/${DAY}.jsonl`],
      line: `{"kind":"call","at":"${AT}","session":"s1","agent":null,"cwd":"/w","tool":"Read","id":"tu1","ms":${TOOK},"outcome":"ok","error":false,"readOnly":true,"chars":5,"input":{"file_path":"/w/a.md"}}\n`,
    },
  ]);
});

test('an errored call is an error, its size what the model read', async ($, on) => {
  const { appends, time } = engine(on, {
    answer: { isError: true, result: 'boom', text: 'boom!' },
  });
  await call($, time, { file_path: '/w/a.md', tool: 'Read' });
  expect(lines(appends)).toEqual([
    expect.objectContaining({
      chars: 'boom!'.length,
      error: true,
      outcome: 'error',
      readOnly: false,
    }),
  ]);
});

test('a denied call is logged with its deny, the guard beneath this hook', async ($, on) => {
  const { appends, time } = engine(on);
  expect(await call($, time, { command: 'git stash', tool: 'Bash' })).toMatchObject({
    deny: expect.stringContaining('never `git stash`'),
  });
  const [line] = lines(appends);
  expect(line).toMatchObject({
    chars: 0,
    deny: expect.stringMatching(/^subether: never `git stash`/u),
    input: { command: 'git stash' },
    ms: 0,
    outcome: 'denied',
  });
  expect(Object.keys(line ?? {})).toEqual([
    'kind',
    'at',
    'session',
    'agent',
    'cwd',
    'tool',
    'id',
    'ms',
    'outcome',
    'deny',
    'error',
    'readOnly',
    'chars',
    'input',
  ]);
});

test('a Bash record adds its flags and stderr size, never its output', async ($, on) => {
  const record = { backgroundTaskId: 'b1', interrupted: true, stderr: 'warn', stdout: 'secret' };
  const { appends, time } = engine(on, { answer: { result: record, text: 'secret' } });
  await call($, time, { command: 'sleep 9', tool: 'Bash' });
  const [line] = appends;
  expect(line?.line).toContain(
    `"chars":6,"bash":{"interrupted":true,"background":true,"stderr":4},"input":`,
  );
  expect(line?.line).not.toContain('"secret"');
});

test('a Bash record in the foreground, uninterrupted, says so', async ($, on) => {
  const record = { interrupted: false, stderr: '', stdout: '' };
  const { appends, time } = engine(on, { answer: { result: record, text: '' } });
  await call($, time, { command: 'ls', tool: 'Bash' });
  expect(lines(appends)).toEqual([
    expect.objectContaining({ bash: { background: false, interrupted: false, stderr: 0 } }),
  ]);
});

test('string arguments are cut at 2,000 characters, nested ones too', async ($, on) => {
  const { appends, time } = engine(on);
  const long = 'x'.repeat(CUT + EXTRA);
  await call($, time, { content: long, file_path: '/w/a.md', tool: 'Write' });
  await call($, time, { options: [long], title: 't', tool: 'mcp__docket__open' });
  const cut = `${'x'.repeat(CUT)}…[cut ${EXTRA} chars]`;
  expect(lines(appends).map((line) => (line as { input: unknown }).input)).toEqual([
    { content: cut, file_path: '/w/a.md' },
    { options: [cut], title: 't' },
  ]);
});

test('an MCP call from a subagent logs its name and agent, the reserved keys stripped', async ($, on) => {
  const { appends, time } = engine(on);
  await call($, time, {
    agentId: 'a1',
    consent: 'The user pressed "1: Yes"',
    id: 't1',
    requestMeta: { 'anthropic/sources': '[]' },
    tool: 'mcp__docket__show',
    tool_use_id: 'tu2',
  });
  expect(lines(appends)).toEqual([
    expect.objectContaining({
      agent: 'a1',
      id: 'tu2',
      input: { id: 't1' },
      tool: 'mcp__docket__show',
    }),
  ]);
});

for (const [name, environment, path] of [
  ['XDG_STATE_HOME', '{"HOME":"/home/test","XDG_STATE_HOME":"/state"}', '/state/subether/tools'],
  ['HOME', '{"HOME":"/home/test"}', '/home/test/.local/state/subether/tools'],
  ['CLAUDE_TOOL_LOG_DIR over both', '{"CLAUDE_TOOL_LOG_DIR":"/o","XDG_STATE_HOME":"/state"}', '/o'],
] as const) {
  test(`the log directory from ${name}`, async ($, on) => {
    const { appends, time } = engine(on, {
      environment: fixture<Record<string, string>>(environment),
    });
    await call($, time, { file_path: '/w/a.md', tool: 'Read' });
    expect(appends.map(({ argv }) => argv.at(-1))).toEqual([`${path}/${DAY}.jsonl`]);
  });
}

for (const [name, options, line] of [
  ['exits non-zero', { exitCode: 1 }, `tool log: Error: /logs/${DAY}.jsonl: read-only`],
  ['cannot start', { isRefused: true }, expect.stringMatching(/^tool log: /u)],
] as const) {
  test(`an append that ${name} logs once, and the result still returns`, async ($, on) => {
    const { logs, time } = engine(on, options);
    expect(await call($, time, { file_path: '/w/a.md', tool: 'Read' })).toMatchObject({
      result: 'ran',
    });
    expect(logs).toEqual([line]);
  });
}
