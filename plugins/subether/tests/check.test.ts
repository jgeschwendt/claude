import type { On, ToolCheckInput, ToolCheckResult } from 'claude-code';
import { type MockClock, expect, mock, test } from 'claude-code/testing';

/**
early on 2026-11-07 UTC, still 2026-11-06 in every zone west of Greenwich: the file is named by the local day
*/
const AT = '2026-11-07T03:30:00.250Z';
const NOW = Temporal.Instant.from(AT).epochMilliseconds;
const DAY = Temporal.Instant.fromEpochMilliseconds(NOW)
  .toZonedDateTimeISO(Temporal.Now.timeZoneId())
  .toPlainDate()
  .toString();
const INPUT = 1000;
const MINUTE = 60_000;
const OK = 200;
const TOKENS = 377;
const TYPESAFE_MS = 3000;

/**
A typed fixture from JSON, which keeps the probabilities and wire names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;
const ASK = fixture<ToolCheckResult>(
  '{"decision":"ask","reason":"This command requires approval","rule":"Bash(git add:*)"}',
);
/**
a real call on the main loop; `CALL` the same in a subagent's loop
*/
const MAIN = fixture<ToolCheckInput>(
  '{"input":{"command":"git add probe.txt"},"tool":"Bash","tool_use_id":"tu1"}',
);
const CALL = { ...MAIN, agentId: 'a1' };
const MARKERS = '{"destructive":0.1,"outbound":0.2,"routine":0.9,"secrets":0.3}';

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/**
A judge's reply: the four markers, with `tokens` when given; `hang` answers after a minute
*/
type Reply = 'hang' | { tokens?: number };

/**
The engine beneath: core deciding `core`, each judge answering its reply (refused when absent), the states sent, each
append's line (exiting `exitCode`), the log
*/
const engine = (
  on: On,
  {
    core = ASK,
    exitCode = 0,
    kev,
    typesafe,
  }: { core?: ToolCheckResult; exitCode?: number; kev?: Reply; typesafe?: Reply } = {},
): { lines: string[]; logs: string[]; sent: unknown[]; time: MockClock } => {
  const [lines, logs, sent]: [string[], string[], unknown[]] = [[], [], []];
  const time = mock.clock(on, { now: NOW });
  mock.env(
    on,
    fixture<Record<string, string>>(
      '{"CLAUDE_TOOL_LOG_DIR":"/logs","HOME":"/home/test","TYPESAFE_API_KEY":"k"}',
    ),
  );
  on('http.fetch', async ($, e) => {
    const reply = e.url.includes('typesafe') ? typesafe : kev;
    sent.push(field(JSON.parse(e.init?.body ?? '{}'), 'state'));
    if (reply === undefined) {
      return { deny: 'connect ECONNREFUSED' };
    }
    if (reply === 'hang') {
      await time.sleep(MINUTE);
    }
    const usage = typeof reply === 'object' && reply.tokens !== undefined ? reply.tokens : 0;
    const answers = Object.entries(fixture<object>(MARKERS)).map(
      ([name, noul]) => `"${name}":{"noul":${noul}}`,
    );
    const text = `{"answers":{${answers.join(',')}},"usage":${usage === 0 ? '{}' : `{"input_tokens":${usage}}`}}`;
    return { value: { headers: {}, ok: true, status: OK, text } };
  });
  on('process.run', ($, e) => {
    lines.push(e.init?.stdin ?? '');
    expect(e.argv.at(-1)).toBe(`/logs/${DAY}.jsonl`);
    const stderr = 'read-only\n';
    return {
      value: { exitCode, isStderrTruncated: false, isStdoutTruncated: false, stderr, stdout: '' },
    };
  });
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: 's1' }));
  on('tool.check', () => core);
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { lines, logs, sent, time };
};

for (const [name, core, call] of [
  ['an allow', '{"decision":"allow","rule":"Bash(ls)"}', CALL],
  ['a deny', '{"decision":"deny","reason":"no"}', CALL],
  ['a read-only ask', ASK, { ...CALL, isReadOnly: true }],
  ['a query’s ask', ASK, { input: CALL.input, tool: 'Bash' }],
] as const) {
  test(`${name} is returned as core decided it, nothing judged`, async ($, on) => {
    const decided = typeof core === 'string' ? fixture<ToolCheckResult>(core) : core;
    const { lines, sent, time } = engine(on, { core: decided, typesafe: {} });
    expect(await $.tool.check(call)).toEqual(decided);
    await time.settle();
    expect([sent, lines]).toEqual([[], []]);
  });
}

test('an ask on a real write is judged over the call: one check line, keys in wire order, the ask unchanged', async ($, on) => {
  const { lines, logs, sent, time } = engine(on, { typesafe: { tokens: TOKENS } });
  const long = { ...CALL, input: { command: 'x'.repeat(INPUT + 1) } };
  expect(await $.tool.check(long)).toEqual(ASK);
  await time.settle();
  expect(sent).toEqual([
    {
      cwd: '/w',
      input: { command: `${'x'.repeat(INPUT)}…[cut 1 chars]` },
      rules: expect.stringContaining('never force-push'),
      tool: 'Bash',
    },
  ]);
  expect(lines).toEqual([
    `{"kind":"check","at":"${AT}","session":"s1","agent":"a1","tool":"Bash","id":"tu1","core":{"decision":"ask","reason":"This command requires approval","rule":"Bash(git add:*)","hook":null,"setting":null},"judge":"typesafe","markers":${MARKERS},"tokens":${TOKENS},"ms":0}\n`,
  ]);
  expect(logs).toEqual([]);
});

test('the decision never waits on the judge: TypeSafe silent, Kev’s line lands 3 s after', async ($, on) => {
  const { lines, sent, time } = engine(on, { kev: {}, typesafe: 'hang' });
  expect(await $.tool.check(MAIN)).toEqual(ASK);
  await time.settle();
  expect([sent.length, lines]).toEqual([1, []]);
  await time.advance(TYPESAFE_MS);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining(fixture('{"agent":null,"judge":"kev","ms":3000,"tokens":null}')),
  ]);
});

test('both judges down: no line, their log lines, the ask unchanged', async ($, on) => {
  const { lines, logs, time } = engine(on);
  expect(await $.tool.check(CALL)).toEqual(ASK);
  await time.settle();
  expect(lines).toEqual([]);
  expect(logs).toEqual([
    'judge: typesafe down (subether: $.http.fetch: connect ECONNREFUSED)',
    'judge: kev down (subether: $.http.fetch: connect ECONNREFUSED)',
  ]);
});

test('a failed append is one log line', async ($, on) => {
  const { logs, time } = engine(on, { exitCode: 1, typesafe: {} });
  expect(await $.tool.check(CALL)).toEqual(ASK);
  await time.settle();
  expect(logs).toEqual([`check: Error: /logs/${DAY}.jsonl: read-only`]);
});
