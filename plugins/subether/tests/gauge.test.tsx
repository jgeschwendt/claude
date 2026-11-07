import type {
  On,
  RenderSurface,
  SessionMeasureInput,
  SessionUsage,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code';
import { type Engine, type Mounted, expect, mock, test } from 'claude-code/testing';

/**
The Rust suite's fixed instant, 2025-09-04T15:33:20Z
*/
const NOW = 1_757_000_000_000;
const BENEATH = 'engine';
const COLUMNS = 80;
const MS = 1000;
const SECONDS = NOW / MS;
const PERCENT = 100;
const POLL = 15_000;
const THRESHOLD = 167_000;
const TREND = 120_000;
const FILE = '/s/window.json';
const IN_5H = 18_000;
const MARGIN = 4;
const RESET = SECONDS + IN_5H;
const USED = 31.4;
const WALL = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/**
A typed fixture from JSON, which keeps the tables' figures and wire names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;
const iso = (seconds: number): string =>
  Temporal.Instant.fromEpochMilliseconds(seconds * MS).toString();
const five = (resetsAt: number, used: number | string): string =>
  `,"rateLimits":[{"kind":"five_hour","percentUsed":${used},"resetsAt":"${iso(resetsAt)}"}]`;
const wall = (seconds: number): string =>
  WALL.format(seconds * MS)
    .toLowerCase()
    .replaceAll(/\s/gu, '');

/**
The engine beneath: a clock, env, a file system `mv` moves within, and every call the gauge makes
*/
const engine = (
  on: On,
  {
    breakdown = `{"autoCompactThreshold":${THRESHOLD}}`,
    environment = fixture<Record<string, string>>(`{"CLAUDE_WINDOW_FILE":"${FILE}"}`),
    exitCode = 0,
    model = 'Fable 5.1',
  }: {
    breakdown?: string;
    environment?: Record<string, string>;
    exitCode?: number;
    model?: string;
  } = {},
): {
  files: Map<string, string>;
  logs: string[];
  time: ReturnType<typeof mock.clock>;
  usages: () => number;
} => {
  const files = new Map<string, string>();
  const logs: string[] = [];
  let usages = 0;
  const time = mock.clock(on, { now: NOW });
  mock.env(on, environment);
  on('fs.read', ($, e) => {
    const text = files.get(e.path);
    if (text === undefined) {
      throw new Error('ENOENT');
    }
    return { value: text };
  });
  on('fs.write', ($, e) => {
    files.set(e.path, e.text);
    return { value: undefined };
  });
  on('process.run', ($, e) => {
    const [to = '', from = ''] = e.argv.toReversed();
    files.set(to, files.get(from) ?? '');
    files.delete(from);
    const ran = { exitCode, isStderrTruncated: false, isStdoutTruncated: false };
    return { value: { ...ran, stderr: 'denied', stdout: '' } };
  });
  on('session.id', () => ({ value: 's1' }));
  on('session.measure', ($, e) => ({ changed: e.changed }));
  on('session.model', () => ({ value: model }));
  on('session.usage', () => {
    usages += 1;
    return {
      value: fixture<SessionUsage>(
        `{"context":{"breakdown":${breakdown},"window":200000},"rateLimits":[],"startedAt":0}`,
      ),
    };
  });
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on('ui.render', () => ({ children: [BENEATH], props: {}, type: 'Text' }));
  return { files, logs, time, usages: () => usages };
};

const measure = async ($: Engine, extra = '', tokens = '50000'): Promise<void> => {
  await $.session.measure(
    fixture<SessionMeasureInput>(
      `{"changed":["context"],"context":{"tokens":${tokens},"window":200000},"rateLimits":[]${extra}}`,
    ),
  );
};

const mount = async (
  $: Engine,
  { columns = COLUMNS, isMeasured = true, surface = 'terminal' as RenderSurface } = {},
): Promise<Mounted<RenderSurface, 'PromptHint'>> =>
  await $.ui.mount({
    component: 'PromptHint',
    plugin: 'subether',
    props: { hint: '? for shortcuts', isDraft: false, isWorking: false },
    surface,
    viewport: isMeasured ? { columns, rows: 1 } : undefined,
  });

const row = async ($: Engine, options?: Parameters<typeof mount>[1]): Promise<string> => {
  const ui = await mount($, options);
  const drawn = (await ui.find({ type: 'Box' })) ?? (await ui.find({ type: 'Text' }));
  await ui.unmount();
  const text = drawn?.text ?? '';
  // a drawn row carries the engine's hint beneath it; the yield IS the hint
  return text === BENEATH ? text : text.replace(BENEATH, '');
};

const step = async ($: Engine, on: On, effort?: number | string): Promise<void> => {
  on('turn.step', async function* turn() {
    yield* [];
    return fixture<TurnStepResult>(
      '{"answer":"","index":0,"stopReason":"end_turn","toolUses":[],"turnId":"t","usage":null}',
    );
  });
  const input = { effort, index: 0, messageCount: 1, model: 'm', turnId: 't' };
  const stream = $.turn.step(fixture<TurnStepInput>(JSON.stringify(input)));
  for await (const chunk of stream) {
    expect(chunk).toBeUndefined();
  }
};

for (const expected of ['m ████░░░░ 50%', 'm ████▏░░░ 52%', 'm ░░░░ 0%', 'm ████ 100%', 'm  75%']) {
  test(`the bar fills ⅛-cells of what the row leaves: ${expected}`, async ($, on) => {
    engine(on, { model: 'm' });
    const pct = Number(expected.slice(expected.lastIndexOf(' ') + 1, -1));
    await measure($, '', String((THRESHOLD * pct) / PERCENT));
    expect(await row($, { columns: expected.length + MARGIN })).toBe(expected);
  });
}

for (const tone of ['49 #87af87', '50 #d7af5f', '75 #ff8700', '90 #ff5f5f']) {
  test(`the bar and digits shift tone: ${tone}`, async ($, on) => {
    const [pct = '', color] = tone.split(' ', 2);
    engine(on);
    await measure($, '', String((THRESHOLD * Number(pct)) / PERCENT));
    const ui = await mount($);
    const digits = await ui.find({ text: ` ${pct}%`, type: 'Text' });
    expect(digits?.props).toMatchObject({ color });
    await ui.unmount();
  });
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the row yields before the first reading, then keeps the hint beneath: ${surface}`, async ($, on) => {
    engine(on);
    expect(await row($, { surface })).toBe(BENEATH);
    await measure($);
    expect(await row($, { surface })).toStartWith('Fable 5.1 ');
    const ui = await mount($, { surface });
    const box = await ui.find({ type: 'Box' });
    expect(box?.text).toEndWith(BENEATH);
    await ui.unmount();
  });
}

const FULL = `,"cost":{"usd":1.2}${five(RESET, USED)}`;
const SEGMENTS: [string, string, number | string | undefined, string, (text: string) => void][] = [
  [
    'a sub-cent cost, high effort',
    'Fable 5.1',
    'high',
    ',"cost":{"usd":0.001}',
    (text): void => {
      expect(text).not.toMatch(/[$(]/u);
    },
  ],
  [
    'a model id, shown as its name',
    'claude-fable-5-1',
    undefined,
    '',
    (text): void => {
      expect(text).toStartWith('Fable 5.1 ');
    },
  ],
  [
    'every segment',
    'Fable 5.1',
    'low',
    FULL,
    (text): void => {
      const bar = '█████████░░░░░░░░░░░░░░░░░░░░░';
      expect(text).toBe(`Fable 5.1 (low) ${bar} 30% · $1.20 · 5h 31% ↻ ${wall(RESET)}`);
      expect(text).toHaveLength(COLUMNS - MARGIN);
    },
  ],
  [
    'hostile text, inert',
    'M\u{1B}]0;x\u{7}',
    'l\u{1B}ow',
    '',
    (text): void => {
      expect(text).toStartWith('M]0;x (low) ');
    },
  ],
  [
    'a bell for effort',
    'm',
    '\u{7}',
    '',
    (text): void => {
      expect(text).not.toContain('(');
    },
  ],
  [
    'high behind an escape',
    'm',
    'hig\u{1B}h',
    '',
    (text): void => {
      expect(text).not.toContain('(');
    },
  ],
  [
    'a number of effort',
    'm',
    2,
    '',
    (text): void => {
      expect(text).toStartWith('m (2) ');
    },
  ],
  [
    'a used past 100, no reset',
    'm',
    undefined,
    ',"rateLimits":[{"kind":"five_hour","percentUsed":101}]',
    (text): void => {
      expect(text).toEndWith(' 5h 100%');
    },
  ],
  [
    'a half-cent tie',
    'm',
    undefined,
    ',"cost":{"usd":0.015}',
    (text): void => {
      expect(text).toEndWith(' · $0.01');
    },
  ],
  [
    'an exact eighth',
    'm',
    undefined,
    ',"cost":{"usd":1.125}',
    (text): void => {
      expect(text).toEndWith(' · $1.13');
    },
  ],
  [
    'past 200k tokens',
    'm',
    undefined,
    `${FULL},"context":{"tokens":250000,"window":200000}`,
    (text): void => {
      expect(text).toContain(' 100% · $1.20 · 5h 31%† ↻ ');
    },
  ],
];
for (const [name, model, effort, extra, holds] of SEGMENTS) {
  test(`the row shows each segment only with its data: ${name}`, async ($, on) => {
    engine(on, { model });
    await step($, on, effort);
    await measure($, extra);
    holds(await row($));
  });
}

test('the bar is 20 cells until the window is measured', async ($, on) => {
  engine(on, { model: 'm' });
  await measure($, '', String(THRESHOLD / 2));
  expect(await row($, { isMeasured: false })).toBe('m ██████████░░░░░░░░░░ 50%');
});

test('the bar measures against the window when auto-compact is off', async ($, on) => {
  engine(on, { breakdown: '{}' });
  await measure($);
  expect(await row($)).toEndWith(' 25%');
});

for (const trend of [
  '10000 120000 1m',
  '150000 170000 ',
  '130000 120000 ',
  '119999 120000 ',
  '10000 0 ',
  '10000 60000 ',
  '76000 160000 1m',
  '159650 160000 40m',
  '158900 159020 2h13m',
  '163290 163410 1h0m',
]) {
  test(`the ETA comes only from a live forward trend: ${trend}`, async ($, on) => {
    const { eta, prior, tokens } =
      /(?<prior>\d+) (?<tokens>\d+) (?<eta>\S*)/u.exec(trend)?.groups ?? {};
    const { time } = engine(on);
    await measure($, '', prior);
    await time.advance(TREND);
    await measure($, '', tokens);
    const text = await row($);
    expect(/≈(?<eta>\S+)/u.exec(text)?.groups?.eta ?? '').toBe(eta);
  });
}

test('samples land one per 15 s, the newest 40', async ($, on) => {
  const every = 15_000;
  const kept = 40;
  const readings = 126;
  const tick = 5000;
  const { time } = engine(on);
  const written: unknown[] = [];
  on('state.get', () => ({ value: { value: written.at(-1), version: 0 } }));
  on('state.set', ($$, e) => {
    if (e.key === 'samples') {
      written.push(e.value);
    }
    return { value: { isSet: true, version: 0 } };
  });
  // in order: each reading sees the samples the last one kept
  const read = async (index: number): Promise<void> => {
    if (index === readings) {
      return;
    }
    await measure($, '', String(index + 1));
    await time.advance(tick);
    await read(index + 1);
  };
  await read(0);
  const ats = Array.from({ length: kept }, (unused, index) => NOW + every * (index + 2));
  expect(written.at(-1)).toEqual(ats.map((at) => expect.objectContaining({ at })));
});

test('one reading at the start in every session; the 15 s poll in interactive ones only', async ($, on) => {
  // the first reading is one usage call plus the threshold's breakdown; each poll one more
  const atStart = 2;
  const polls = TREND / POLL;
  const { time, usages } = engine(on);
  on('session.start', () => ({ cwd: '/w' }));
  await $.session.start({ cwd: '/w', isInteractive: false, surface: 'terminal' });
  expect(await row($)).toStartWith('Fable 5.1 ░');
  await time.advance(TREND);
  expect(usages()).toBe(atStart);
  await $.session.start({ cwd: '/w', isInteractive: true, surface: 'terminal' });
  await time.advance(TREND);
  expect(usages()).toBe(atStart + 1 + polls);
});

test('window.json is persisted and never rolled back', async ($, on) => {
  const earlierIn = 10_000;
  const laterIn = 20_000;
  const [earlier, later] = [SECONDS + earlierIn, SECONDS + laterIn];
  const millisecondReset = 1_791_773_097_000;
  const year2100 = 4_102_444_800;
  const [over, under] = ['101', '-3'];
  const { files, logs } = engine(on);
  let tokens = 0;
  const write = async (extra: string): Promise<unknown> => {
    tokens += 1;
    await measure($, extra, String(tokens));
    return Reflect.get(fixture<object>(files.get(FILE) ?? '{}'), 'five_hour');
  };
  expect(await write('')).toBeUndefined();
  expect(await write(',"rateLimits":[{"kind":"five_hour","percentUsed":10}]')).toBeUndefined();
  expect(await write(five(SECONDS, '10'))).toBeUndefined();
  expect(await write(five(millisecondReset, '10'))).toBeUndefined();
  expect(await write(five(RESET, over))).toBeUndefined();
  expect(await write(five(RESET, under))).toBeUndefined();
  expect(logs).toEqual(
    [over, under].map((used) => `gauge: window: used_percentage ${used} is outside 0–100`),
  );
  await write(five(RESET, String(USED)));
  expect(Object.fromEntries(files)).toEqual({
    [FILE]: `{"at":"2025-09-04T15:33:20Z","five_hour":{"resets_at":${RESET},"used_percentage":31.4},"session_id":"s1"}\n`,
  });
  files.set(FILE, `{"five_hour":{"resets_at":${year2100},"used_percentage":99}}`);
  expect(await write(five(RESET, '92'))).toEqual(
    fixture(`{"resets_at":${RESET},"used_percentage":92}`),
  );
  expect(await write(five(RESET, '40'))).toMatchObject(fixture('{"used_percentage":92}'));
  expect(await write(five(earlier, '99'))).toMatchObject(fixture('{"used_percentage":92}'));
  expect(await write(five(later, '3'))).toMatchObject(fixture('{"used_percentage":3}'));
});

for (const [environment, written] of [
  ['{"XDG_STATE_HOME":"/x"}', '{"/x/claude/window.json":"…"}'],
  ['{"HOME":"/h"}', '{"/h/.local/state/claude/window.json":"…"}'],
  ['{}', '{}'],
] as const) {
  test(`window.json falls back to XDG_STATE_HOME, then HOME: ${environment}`, async ($, on) => {
    const { files } = engine(on, { environment: fixture(environment) });
    await measure($, FULL);
    expect(Object.keys(Object.fromEntries(files))).toEqual(Object.keys(fixture<object>(written)));
  });
}

test('a failed move is one log line', async ($, on) => {
  const { logs } = engine(on, { exitCode: 1 });
  await measure($, FULL);
  expect(logs).toEqual([`gauge: window: ${FILE}: Error: denied`]);
});
