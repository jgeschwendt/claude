import type { HttpInit, On, PluginState } from 'claude-code';
import { type Engine, type MockClock, expect, mock, test } from 'claude-code/testing';

/**
2025-09-04T15:33:20Z
*/
const NOW = 1_757_000_000_000;
const KEY = 'k-test';
const KEV_MS = 5000;
const MINUTE = 60_000;
const OK = 200;
const PROBE_MS = 1000;
const REFUSED = 'subether: $.http.fetch: connect ECONNREFUSED';
const SESSION = Number.MAX_SAFE_INTEGER;
const TOKENS = 412;
const TYPESAFE_MS = 3000;

/**
A typed fixture from JSON, which keeps the probabilities, statuses and wire names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;
const LOW = fixture<Record<string, number>>(
  '{"approval":0.1,"correction":0.2,"preference":0.3,"repeat":0.4}',
);
const WITH_KEY = fixture<Record<string, string>>(
  `{"HOME":"/home/test","TYPESAFE_API_KEY":"${KEY}"}`,
);

type Judge = 'kev' | 'typesafe';
/**
one judge's answer to one request: none until a minute passes, a refused fetch, or a response (200 unless `status` says)
*/
type Reply =
  | 'hang'
  | { deny: string }
  | { headers?: Record<string, string>; status?: number; text?: string };

/**
A System One reply of `LOW`, its usage carrying `tokens` when given
*/
const answer = (tokens?: number): Reply => {
  const answers = Object.fromEntries(
    Object.entries(LOW).map(([name, noul]) => [name, { noul, type: 'noul' }]),
  );
  const usage = tokens === undefined ? '{}' : `{"input_tokens":${tokens},"output_tokens":1}`;
  return { text: `{"answers":${JSON.stringify(answers)},"model":"m","usage":${usage}}` };
};

/**
The engine beneath: each judge answering its replies in turn (then refusing), every fetch, the judge's log lines, and
each atom's last write
*/
const engine = (
  on: On,
  replies: Partial<Record<Judge, Reply[]>>,
  environment = WITH_KEY,
): {
  fetches: { init?: HttpInit; judge: Judge; url: string }[];
  logs: string[];
  state: Partial<PluginState['subether']>;
  time: MockClock;
} => {
  const time = mock.clock(on, { now: NOW });
  const asked = { kev: 0, typesafe: 0 };
  const fetches: { init?: HttpInit; judge: Judge; url: string }[] = [];
  const logs: string[] = [];
  const state: Record<string, unknown> = {};
  mock.env(on, environment);
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('http.fetch', async ($, e) => {
    const judge = e.url.startsWith('https://api.typesafe.ai/') ? 'typesafe' : 'kev';
    fetches.push({ init: e.init, judge, url: e.url });
    const reply = replies[judge]?.[asked[judge]] ?? { deny: 'connect ECONNREFUSED\nmore' };
    asked[judge] += 1;
    if (reply === 'hang') {
      await time.sleep(MINUTE);
      return { value: { headers: {}, ok: true, status: OK, text: '' } };
    }
    const { status = OK } = 'deny' in reply ? {} : reply;
    return 'deny' in reply
      ? reply
      : { value: { headers: {}, ok: String(status).startsWith('2'), status, text: '', ...reply } };
  });
  on('process.run', () => ({
    value: {
      exitCode: 0,
      isStderrTruncated: false,
      isStdoutTruncated: false,
      stderr: '',
      stdout: '',
    },
  }));
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.id', () => ({ value: 's1' }));
  on('session.messages', () => ({ value: [] }));
  on('session.start', () => ({ cwd: '/w' }));
  on('state.set', async ($, e, next) => {
    state[e.key] = e.value;
    return await next(e);
  });
  on('ui.log', ($, e) => {
    logs.push(...(e.text.startsWith('judge') ? [e.text] : []));
    return { value: undefined };
  });
  on('ui.open', () => ({ value: { isPlaced: true } }));
  return { fetches, logs, state, time };
};

/**
A composer prompt, then everything it left running unawaited, as far as it gets without the clock moving
*/
const say = async ($: Engine, time: MockClock): Promise<void> => {
  await $.prompt.submit({ origin: { kind: 'composer' }, text: 'no', wait: false });
  await time.settle();
};

test('TypeSafe answers first: its probabilities and input tokens kept, the bearer and jev-latest sent, Kev never asked', async ($, on) => {
  const { fetches, logs, state, time } = engine(on, { typesafe: [answer(TOKENS)] });
  await say($, time);
  expect(fetches.map(({ judge }) => judge)).toEqual(['typesafe']);
  expect(fetches[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
  expect(fetches[0]?.init).toMatchObject({
    headers: { 'authorization': `Bearer ${KEY}`, 'content-type': 'application/json' },
    method: 'POST',
  });
  expect(JSON.parse(String(fetches[0]?.init?.body))).toMatchObject({ model: 'jev-latest' });
  expect(state.judged).toEqual([
    { at: NOW, head: 'no', judge: 'typesafe', markers: LOW, tokens: TOKENS },
  ]);
  expect(state.gate).toEqual({ kev: { why: '' }, typesafe: { why: '' } });
  expect(logs).toEqual([]);
});

for (const [name, reply, down, why] of [
  [
    'a 429 with Retry-After 120',
    '{"headers":{"retry-after":"120"},"status":429}',
    2,
    'rate limited',
  ],
  [
    'a 429 with an HTTP-date',
    '{"headers":{"retry-after":"Thu, 04 Sep 2025 15:35:20 GMT"},"status":429}',
    2,
    'rate limited',
  ],
  [
    'a 429 with an unreadable month',
    '{"headers":{"retry-after":"Thu, 04 Foo 2025 15:35:20 GMT"},"status":429}',
    1,
    'rate limited',
  ],
  ['a 529 without Retry-After', '{"status":529}', 1, 'overloaded'],
  ['a 500', '{"status":500}', 1, 'status 500'],
  [
    'an answer missing a marker',
    String.raw`{"text":"{\"answers\":{}}"}`,
    1,
    'no answers in the reply',
  ],
  ['a body that is not JSON', '{"text":"<html>"}', 1, 'no answers in the reply'],
  ['a refused fetch', String.raw`{"deny":"connect ECONNREFUSED\nmore"}`, 1, REFUSED],
] as const) {
  test(`${name}: Kev answers, TypeSafe down ${down} min (${why})`, async ($, on) => {
    const { fetches, logs, state, time } = engine(on, {
      kev: [answer()],
      typesafe: [fixture(reply)],
    });
    await say($, time);
    expect(fetches.map(({ judge }) => judge)).toEqual(['typesafe', 'kev']);
    expect(fetches[1]?.url).toBe('http://127.0.0.1:1703/v1/systemone');
    expect(fetches[1]?.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(fetches[1]?.init?.body))).toMatchObject({ model: 'kev-latest' });
    expect(state.gate).toEqual({ kev: { why: '' }, typesafe: { until: NOW + down * MINUTE, why } });
    expect(state.judged).toEqual([{ at: NOW, head: 'no', judge: 'kev', markers: LOW }]);
    expect(logs).toEqual([`judge: typesafe down (${why})`]);
  });
}

for (const status of ['401', '403']) {
  test(`a ${status} is TypeSafe down for the session, never asked again`, async ($, on) => {
    const { fetches, state, time } = engine(on, {
      kev: [answer(), answer()],
      typesafe: [fixture(`{"status":${status}}`)],
    });
    await say($, time);
    await time.advance(SESSION - NOW - 1);
    await say($, time);
    expect(fetches.map(({ judge }) => judge)).toEqual(['typesafe', 'kev', 'kev']);
    expect(state.gate).toMatchObject({
      typesafe: { until: SESSION, why: `key refused (${status})` },
    });
  });
}

test('with no TYPESAFE_API_KEY only Kev is asked, TypeSafe down for the session', async ($, on) => {
  const { fetches, logs, state, time } = engine(on, { kev: [answer()] }, { HOME: '/home/test' });
  await say($, time);
  expect(fetches.map(({ judge }) => judge)).toEqual(['kev']);
  expect(state.gate).toEqual({
    kev: { why: '' },
    typesafe: { until: SESSION, why: 'no TYPESAFE_API_KEY' },
  });
  expect(logs).toEqual(['judge: typesafe down (no TYPESAFE_API_KEY)']);
});

test('both down: nothing is asked, no judge recorded, one log line', async ($, on) => {
  const { fetches, logs, state, time } = engine(on, {}, { HOME: '/home/test' });
  await say($, time);
  expect(logs).toHaveLength(2);
  [fetches.length, logs.length] = [0, 0];
  await say($, time);
  expect(fetches).toEqual([]);
  expect(logs).toEqual([`judge: no judge up (typesafe no TYPESAFE_API_KEY, kev ${REFUSED})`]);
  expect(state.judged).toEqual([1, 2].map(() => ({ at: NOW, head: 'no', markers: {} })));
});

test('a down judge is tried again once its until has passed', async ($, on) => {
  const limited = fixture<Reply>('{"headers":{"retry-after":"60"},"status":429}');
  const { fetches, time } = engine(on, {
    kev: [answer(), answer()],
    typesafe: [limited, answer()],
  });
  await say($, time);
  await time.advance(MINUTE - 1);
  await say($, time);
  expect(fetches.map(({ judge }) => judge)).toEqual(['typesafe', 'kev', 'kev']);
  await time.advance(1);
  await say($, time);
  expect(fetches.map(({ judge }) => judge)).toEqual(['typesafe', 'kev', 'kev', 'typesafe']);
});

test('a TypeSafe silent 3 s timed out; a Kev silent 5 s is busy, each down 60 s', async ($, on) => {
  const { state, time } = engine(on, { kev: ['hang'], typesafe: ['hang'] });
  await say($, time);
  await time.advance(TYPESAFE_MS);
  expect(state.gate).toEqual({
    kev: { why: '' },
    typesafe: { until: NOW + TYPESAFE_MS + MINUTE, why: 'timed out' },
  });
  await time.advance(KEV_MS - 1);
  expect(state.gate).toMatchObject({ kev: { why: '' } });
  await time.advance(1);
  expect(state.gate).toMatchObject({
    kev: { until: NOW + TYPESAFE_MS + KEV_MS + MINUTE, why: 'busy' },
  });
});

test('an interactive start probes both judges with a free GET /v1/models, marking each; a headless one does not', async ($, on) => {
  const { fetches, state, time } = engine(on, {
    kev: [{ deny: 'connect ECONNREFUSED' }],
    typesafe: [{ text: '{"models":[]}' }],
  });
  await $.session.start({ cwd: '/w', isInteractive: false, surface: 'terminal' });
  await time.settle();
  expect(fetches).toEqual([]);
  await $.session.start({ cwd: '/w', isInteractive: true, surface: 'terminal' });
  await time.settle();
  // at once, so in either order
  expect(fetches.toSorted((one, other) => one.judge.localeCompare(other.judge))).toEqual([
    { init: { headers: {} }, judge: 'kev', url: 'http://127.0.0.1:1703/v1/models' },
    {
      init: { headers: { authorization: `Bearer ${KEY}` } },
      judge: 'typesafe',
      url: 'https://api.typesafe.ai/v1/models',
    },
  ]);
  expect(state.gate).toEqual({ kev: { until: NOW + MINUTE, why: REFUSED }, typesafe: { why: '' } });
});

test('a probe refused is down for the session; one unanswered in 1 s busy', async ($, on) => {
  const { state, time } = engine(on, { kev: ['hang'], typesafe: [fixture('{"status":401}')] });
  await $.session.start({ cwd: '/w', isInteractive: true, surface: 'terminal' });
  await time.advance(PROBE_MS);
  expect(state.gate).toEqual({
    kev: { until: NOW + PROBE_MS + MINUTE, why: 'busy' },
    typesafe: { until: SESSION, why: 'key refused (401)' },
  });
});
