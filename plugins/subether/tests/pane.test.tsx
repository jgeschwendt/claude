import type { HttpResponse, On, PaneOpenArgs, PluginState } from 'claude-code';
import { type Engine, type MockClock, expect, mock, test } from 'claude-code/testing';

const NOW = 1_757_000_000_000;
const COLUMNS = 160;
const BODY_COLUMNS = 60;
const BODY_ROWS = 10;
const ROWS = 40;
const MINUTE = 60_000;
const OTHER = 'theirs';
const RECALL = 'first recall';
const PANE = { id: 'subether', title: 'subether · injected' };
const UP = '~judge · typesafe up · kev up';

/**
A typed fixture from JSON, which keeps the probabilities and wire names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;

const hhmm = (at: number): string =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });

/**
The engine beneath: `sandman` printing a plain recall, TypeSafe judging every marker unlikely, the commands
registered, the panes opened
*/
const engine = (
  on: On,
): {
  opened: PaneOpenArgs[];
  registered: string[];
  time: MockClock;
} => {
  const opened: PaneOpenArgs[] = [];
  const registered: string[] = [];
  const time = mock.clock(on, { now: NOW });
  mock.env(on, fixture('{"HOME":"/home/test","TYPESAFE_API_KEY":"k"}'));
  on('command.register', ($, e) => {
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on('http.fetch', () => {
    const answers =
      '{"approval":{"noul":0.01},"correction":{"noul":0.05},"preference":{"noul":0.02},"repeat":{"noul":0.03}}';
    return {
      value: fixture<HttpResponse>(
        `{"headers":{},"ok":true,"status":200,"text":${JSON.stringify(`{"answers":${answers}}`)}}`,
      ),
    };
  });
  on('process.run', () => {
    const ran = { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '' };
    return { value: { ...ran, stdout: RECALL } };
  });
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: 's1' }));
  on('session.messages', () => ({ value: [] }));
  on('session.start', () => ({ cwd: '/w' }));
  on('session.usage', () => ({ value: { context: { window: 0 }, rateLimits: [], startedAt: 0 } }));
  on('session.model', () => ({ value: 'm' }));
  on('ui.open', ($, e) => {
    opened.push(e);
    return { value: { isPlaced: true } };
  });
  on('ui.render', () => ({ children: [OTHER], props: {}, type: 'Text' }));
  return { opened, registered, time };
};

/**
The pane drawn, after a press on the header keyed `press`, as its Text lines: `*` bold, `~` dim
*/
const drawn = async (
  $: Engine,
  { id = PANE.id, press }: { id?: string; press?: string } = {},
): Promise<string[]> => {
  const ui = await $.ui.mount({
    component: 'Pane',
    plugin: 'subether',
    props: {
      bodyColumns: BODY_COLUMNS,
      isFocused: false,
      placement: 'dock',
      scroll: { bodyRows: BODY_ROWS, offset: 0 },
      title: PANE.title,
      view: {},
    },
    requestId: id,
    surface: 'terminal',
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  if (press !== undefined) {
    await ui.press({ key: press });
  }
  const texts = await ui.findAll({ type: 'Text' });
  await ui.unmount();
  return texts.map(
    ({ props, text }) =>
      `${props.weight === 'bold' ? '*' : ''}${props.dimColor === true ? '~' : ''}${text}`,
  );
};

test('with nothing injected or judged the pane says so in one dim line, under the judge line', async ($, on) => {
  engine(on);
  expect(await drawn($)).toEqual([
    UP,
    '~nothing injected yet — the first prompt attaches sandman recall',
  ]);
});

test('the recall the first prompt attached is a collapsed bold header, the prompt judged beneath; a press expands it, a second collapses it', async ($, on) => {
  const { time } = engine(on);
  await $.prompt.submit({ origin: { kind: 'composer' }, text: 'hi', wait: false });
  await time.settle();
  const header = `${hhmm(NOW)} · sandman recall · 12 chars`;
  const judged = `*▸ ${hhmm(NOW)} · judged · hi · correction 0.05`;
  expect(await drawn($)).toEqual([UP, `*▸ ${header}`, judged]);
  expect(await drawn($, { press: `injected:${NOW}` })).toEqual([
    UP,
    `*▾ ${header}`,
    `~${RECALL}`,
    ' ',
    judged,
  ]);
  expect(await drawn($, { press: `injected:${NOW}` })).toEqual([UP, `*▸ ${header}`, judged]);
});

test('blocks are drawn newest first, each toggled alone, a cut one saying so and a failed one expanding to its error', async ($, on) => {
  engine(on);
  const block = { chars: 1, cut: false, source: 'sandman recall', text: 'a' };
  const blocks = [
    { ...block, at: NOW },
    { ...block, at: NOW + MINUTE, cut: true, text: 'b' },
    { ...block, at: NOW + MINUTE + MINUTE, chars: 0, error: 'Error: printed nothing', text: '' },
  ];
  on('state.get', async (_dollar, e, next) =>
    e.key === 'injected' ? { value: { value: blocks, version: 1 } } : await next(e),
  );
  await drawn($, { press: `injected:${NOW + MINUTE + MINUTE}` });
  expect(await drawn($, { press: `injected:${NOW}` })).toEqual([
    UP,
    `*▾ ${hhmm(NOW + MINUTE + MINUTE)} · sandman recall · failed`,
    '~Error: printed nothing',
    ' ',
    `*▸ ${hhmm(NOW + MINUTE)} · sandman recall · 1 chars, cut`,
    `*▾ ${hhmm(NOW)} · sandman recall · 1 chars`,
    '~a',
    ' ',
  ]);
});

for (const [gate, line] of [
  [{ kev: { why: '' }, typesafe: { until: NOW, why: 'rate limited' } }, UP],
  [
    {
      kev: { until: NOW + MINUTE, why: 'busy' },
      typesafe: { until: Number.MAX_SAFE_INTEGER, why: 'key refused (401)' },
    },
    `~judge · typesafe down (key refused (401)) · kev down until ${hhmm(NOW + MINUTE)} (busy)`,
  ],
] as const) {
  test(`the judge line: ${line}`, async ($, on) => {
    engine(on);
    on('state.get', async (_dollar, e, next) =>
      e.key === 'gate' ? { value: { value: gate, version: 1 } } : await next(e),
    );
    const [judge] = await drawn($);
    expect(judge).toBe(line);
  });
}

test('judged prompts are drawn newest first after the injected rows, each expanding to its four markers and its judge', async ($, on) => {
  engine(on);
  const markers = '{"approval":0.01,"correction":0.934,"preference":0.1,"repeat":0.2}';
  const judged = fixture<PluginState['subether']['judged']>(`[
    {"at":${NOW},"head":"no, I said use the rewrite\\nand keep this long line going","judge":"typesafe","markers":${markers},"tokens":412},
    {"at":${NOW + MINUTE},"head":"go ahead","judge":"kev","markers":${markers.replace('0.01', '0.9')}},
    {"at":${NOW + MINUTE + MINUTE},"head":"hi","markers":{}}
  ]`);
  on('state.get', async (_dollar, e, next) =>
    e.key === 'judged' ? { value: { value: judged, version: 1 } } : await next(e),
  );
  await drawn($, { press: `judged:${NOW + MINUTE}` });
  await drawn($, { press: `judged:${NOW + MINUTE + MINUTE}` });
  expect(await drawn($, { press: `judged:${NOW}` })).toEqual([
    UP,
    `*▾ ${hhmm(NOW + MINUTE + MINUTE)} · judged · hi · no judge`,
    '~no judge answered',
    ' ',
    `*▾ ${hhmm(NOW + MINUTE)} · judged · go ahead · correction 0.93`,
    '~approval 0.90\ncorrection 0.93\npreference 0.10\nrepeat 0.20\nby kev',
    ' ',
    `*▾ ${hhmm(NOW)} · judged · no, I said use the rewrite and keep this… · correction 0.93`,
    '~approval 0.01\ncorrection 0.93\npreference 0.10\nrepeat 0.20\nby typesafe, 412 input tokens',
    ' ',
  ]);
});

test('another pane is left to the engine', async ($, on) => {
  engine(on);
  expect(await drawn($, { id: OTHER })).toEqual([OTHER]);
});

test('an interactive session starts with the pane opened unasked and /subether registered; another with neither', async ($, on) => {
  const { opened, registered } = engine(on);
  await $.session.start({ cwd: '/w', isInteractive: false, surface: 'terminal' });
  expect(opened).toEqual([]);
  await $.session.start({ cwd: '/w', isInteractive: true, surface: 'terminal' });
  expect(opened).toEqual([PANE]);
  expect(registered).toEqual(['subether']);
});

test('/subether opens the pane, asked, and prints nothing', async ($, on) => {
  const { opened } = engine(on);
  expect(
    await $.command.run({
      args: '',
      command: 'subether',
      origin: { kind: 'composer' },
      presentation: { columns: COLUMNS, isFullscreen: true },
    }),
  ).toEqual({});
  expect(opened).toEqual([PANE]);
});
