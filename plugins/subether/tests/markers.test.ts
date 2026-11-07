import type {
  HttpResponse,
  On,
  PluginState,
  PromptSubmitInput,
  PromptSubmitResult,
  SessionMessage,
} from 'claude-code';
import { type Engine, type MockClock, expect, mock, test } from 'claude-code/testing';

const AT = '2026-11-07T03:30:00.250Z';
const NOW = Temporal.Instant.from(AT).epochMilliseconds;
const DAY = Temporal.Instant.fromEpochMilliseconds(NOW)
  .toZonedDateTimeISO(Temporal.Now.timeZoneId())
  .toPlainDate()
  .toString();
const HEAD = 200;
const KEPT = 20;
const LINE = 120;
const LONG = 400;
const SAID = "no, don't do that, I said use the rewrite";
const TAIL = 600;
const THRESHOLD = 0.8;

/**
A typed fixture from JSON, which keeps the probabilities and wire names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;
const LOW = '{"approval":0.1,"correction":0.2,"preference":0.3,"repeat":0.4}';

/**
The engine beneath: TypeSafe answering `markers` (refused when absent, Kev too), the bodies it was sent, each trail
append's rationale, each tool log line (its append exiting `exitCode`), the log, each atom's last write, and what the
prompt's bottom answers
*/
const engine = (
  on: On,
  {
    environment = '{}',
    exitCode = 0,
    markers,
    messages = [],
    result,
  }: {
    environment?: string;
    exitCode?: number;
    markers?: string;
    messages?: SessionMessage[];
    result?: PromptSubmitResult;
  } = {},
): {
  lines: string[];
  logs: string[];
  rationales: string[];
  sent: unknown[];
  state: Partial<PluginState['subether']>;
  time: MockClock;
} => {
  const [lines, logs, rationales]: [string[], string[], string[]] = [[], [], []];
  const sent: unknown[] = [];
  const state: Record<string, unknown> = {};
  const time = mock.clock(on, { now: NOW });
  mock.env(on, {
    ...fixture<object>(
      '{"CLAUDE_TOOL_LOG_DIR":"/logs","HOME":"/home/test","TYPESAFE_API_KEY":"k"}',
    ),
    ...fixture<object>(environment),
  });
  on('http.fetch', ($, e) => {
    sent.push(...(e.url.includes('typesafe') ? [JSON.parse(e.init?.body ?? '')] : []));
    const answers = Object.entries(fixture<object>(markers ?? '{}')).map(
      ([name, noul]) => `"${name}":{"noul":${noul}}`,
    );
    const text = JSON.stringify(`{"answers":{${answers.join(',')}}}`);
    return markers === undefined
      ? { deny: 'refused' }
      : { value: fixture<HttpResponse>(`{"headers":{},"ok":true,"status":200,"text":${text}}`) };
  });
  on('process.run', ($, e) => {
    const isLog = e.argv[0] === '/bin/sh';
    (isLog ? lines : rationales).push(
      isLog ? (e.init?.stdin ?? '') : (e.argv[e.argv.indexOf('--rationale') + 1] ?? ''),
    );
    const code = isLog ? exitCode : 0;
    return {
      value: {
        exitCode: code,
        isStderrTruncated: false,
        isStdoutTruncated: false,
        stderr: 'read-only\n',
        stdout: '',
      },
    };
  });
  on('prompt.submit', ($, e) => result ?? { text: e.text });
  on('session.id', () => ({ value: 's1' }));
  on('session.messages', () => ({ value: messages }));
  on('state.set', async ($, e, next) => {
    state[e.key] = e.value;
    return await next(e);
  });
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { lines, logs, rationales, sent, state, time };
};

/**
A prompt, the composer's unless `input` says, then the judging it left running
*/
const say = async (
  $: Engine,
  time: MockClock,
  input: Partial<PromptSubmitInput> & { text: string },
): Promise<PromptSubmitResult> => {
  const result = await $.prompt.submit({ origin: { kind: 'composer' }, wait: false, ...input });
  await time.settle();
  return result;
};

/**
The prompts in turn, each judged before the next
*/
const sayEach = async ($: Engine, time: MockClock, texts: readonly string[]): Promise<void> => {
  const [text, ...rest] = texts;
  if (text === undefined) {
    return;
  }
  await say($, time, { text });
  await sayEach($, time, rest);
};

for (const [name, input] of [
  ['an SDK prompt', { origin: { kind: 'sdk' }, text: SAID }],
  ['a meta prompt', { isMeta: true, text: SAID }],
  ['a slash command', { command: { args: '', name: 'compact' }, text: '/compact' }],
  ['a prompt over 400 characters', { text: 'n'.repeat(LONG + 1) }],
  ['a `# ` brief', { text: `# brief\n${SAID}` }],
] as const) {
  test(`${name} is not judged nor kept as an earlier prompt`, async ($, on) => {
    const { sent, state, time } = engine(on, { markers: LOW });
    await say($, time, input);
    expect(sent).toEqual([]);
    expect(state.prompts).toBeUndefined();
  });
}

test('a dropped prompt is not judged', async ($, on) => {
  const { sent, time } = engine(on, { markers: LOW, result: { drop: 'no' } });
  expect(await say($, time, { text: SAID })).toEqual({ drop: 'no' });
  expect(sent).toEqual([]);
});

test("a --bg session's opening prompt is dispatch's brief, not judged; its second is", async ($, on) => {
  const { sent, time } = engine(on, {
    environment: '{"CLAUDE_CODE_SESSION_KIND":"bg"}',
    markers: LOW,
  });
  await say($, time, { text: 'the brief' });
  expect(sent).toEqual([]);
  await say($, time, { text: SAID });
  expect(sent).toMatchObject([{ state: { 'earlier prompts': [], 'prompt': SAID } }]);
});

test('the state sent: no previous answer before one exists; a 400-character prompt is judged', async ($, on) => {
  const { sent, time } = engine(on, { markers: LOW });
  await say($, time, { text: 'n'.repeat(LONG) });
  expect(sent).toEqual([
    expect.objectContaining({ state: { 'earlier prompts': [], 'prompt': 'n'.repeat(LONG) } }),
  ]);
});

test("the state sent: the newest answer's last 600 characters, the last 3 prompts' heads, the prompt", async ($, on) => {
  const messages: SessionMessage[] = [
    { role: 'assistant', text: `ahead${'b'.repeat(TAIL)}`, toolUses: [] },
    { role: 'user', text: 'u', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [] },
  ];
  const { sent, state, time } = engine(on, { markers: LOW, messages });
  await sayEach($, time, ['one', 'x'.repeat(HEAD + 1), 'three', 'four', SAID]);
  const heads = ['x'.repeat(HEAD), 'three', 'four'];
  expect(sent.at(-1)).toMatchObject({
    state: { 'earlier prompts': heads, 'previous answer': 'b'.repeat(TAIL), 'prompt': SAID },
  });
  expect(state.prompts).toEqual([...heads.slice(1), SAID]);
});

for (const [name, prefix] of [
  ['approval', 'approval: '],
  ['correction', ''],
  ['preference', 'preference: '],
  ['repeat', 'repeated instruction: '],
] as const) {
  test(`${name} at 0.8 is a correction event: ${prefix}<head> (p=0.80, typesafe)`, async ($, on) => {
    const { rationales, time } = engine(on, {
      markers: JSON.stringify({ ...fixture<object>(LOW), [name]: THRESHOLD }),
    });
    const text = `${SAID} ${'z'.repeat(HEAD)}`;
    await say($, time, { text });
    expect(rationales).toEqual([`${prefix}${text.slice(0, HEAD)} (p=0.80, typesafe)`]);
  });
}

test('at 0.79 nothing is trailed; two markers over are two events and one prompt line, keys in wire order', async ($, on) => {
  const markers = '{"approval":0.79,"correction":0.93,"preference":0.79,"repeat":0.851}';
  const { lines, rationales, time } = engine(on, { markers });
  const text = `${SAID}\r\n\nthen ${'z'.repeat(HEAD)}`;
  await say($, time, { text });
  const head = text.slice(0, HEAD);
  expect(rationales.toSorted((one, other) => one.localeCompare(other))).toEqual([
    `${head} (p=0.93, typesafe)`,
    `repeated instruction: ${head} (p=0.85, typesafe)`,
  ]);
  const line = `${SAID} then ${'z'.repeat(HEAD)}`.slice(0, LINE);
  expect(lines).toEqual([
    `{"kind":"prompt","at":"${AT}","session":"s1","head":"${line}","judge":"typesafe","markers":${markers},"trailed":["correction","repeat"],"tokens":null,"ms":0}\n`,
  ]);
});

test('a failed append is one log line, the trail still written', async ($, on) => {
  const markers = '{"approval":0.1,"correction":0.9,"preference":0.3,"repeat":0.4}';
  const { logs, rationales, time } = engine(on, { exitCode: 1, markers });
  await say($, time, { text: SAID });
  expect(logs).toContain(`prompt log: Error: /logs/${DAY}.jsonl: read-only`);
  expect(rationales).toEqual([`${SAID} (p=0.90, typesafe)`]);
});

test('with both judges down nothing is trailed or logged, nothing throws, and the prompt goes on unchanged', async ($, on) => {
  const { lines, rationales, state, time } = engine(on);
  expect(await say($, time, { text: SAID })).toEqual({ text: SAID });
  expect([lines, rationales]).toEqual([[], []]);
  expect(state.judged).toEqual([{ at: NOW, head: SAID, markers: {} }]);
});

test('judged keeps the newest 20', async ($, on) => {
  const { state, time } = engine(on, { markers: LOW });
  const texts = Array.from({ length: KEPT + 1 }, (unused, index) => `p${index}`);
  await sayEach($, time, texts);
  expect(state.judged?.map(({ head }) => head)).toEqual(texts.slice(1));
});
