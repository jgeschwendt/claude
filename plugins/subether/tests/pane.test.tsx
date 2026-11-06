import type { On, PaneOpenArgs } from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

const NOW = 1_757_000_000_000;
const COLUMNS = 160;
const BODY_COLUMNS = 60;
const BODY_ROWS = 10;
const ROWS = 40;
const MINUTE = 60_000;
const OTHER = 'theirs';
const RECALL = 'first recall';
const PANE = { id: 'subether', title: 'subether · injected' };

const hhmm = (at: number): string =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });

/**
The engine beneath: `sandman` printing a plain recall, the commands registered, the panes opened
*/
const engine = (
  on: On,
): {
  opened: PaneOpenArgs[];
  registered: string[];
} => {
  const opened: PaneOpenArgs[] = [];
  const registered: string[] = [];
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: '/home/test' });
  on('command.register', ($, e) => {
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on('process.run', () => {
    const ran = { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: '' };
    return { value: { ...ran, stdout: RECALL } };
  });
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: 's1' }));
  on('session.start', () => ({ cwd: '/w' }));
  on('session.usage', () => ({ value: { context: { window: 0 }, rateLimits: [], startedAt: 0 } }));
  on('session.model', () => ({ value: 'm' }));
  on('ui.open', ($, e) => {
    opened.push(e);
    return { value: { isPlaced: true } };
  });
  on('ui.render', () => ({ children: [OTHER], props: {}, type: 'Text' }));
  return { opened, registered };
};

/**
The pane drawn, after a press on the header of the row attached at `press`, as its Text lines: `*` bold, `~` dim
*/
const drawn = async (
  $: Engine,
  { id = PANE.id, press }: { id?: string; press?: number } = {},
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
    await ui.press({ key: `injected:${press}` });
  }
  const texts = await ui.findAll({ type: 'Text' });
  await ui.unmount();
  return texts.map(
    ({ props, text }) =>
      `${props.weight === 'bold' ? '*' : ''}${props.dimColor === true ? '~' : ''}${text}`,
  );
};

test('with nothing injected the pane says so in one dim line', async ($, on) => {
  engine(on);
  expect(await drawn($)).toEqual([
    '~nothing injected yet — the first prompt attaches sandman recall',
  ]);
});

test('the recall the first prompt attached is a collapsed bold header; a press expands it, a second collapses it', async ($, on) => {
  engine(on);
  await $.prompt.submit({ origin: { kind: 'composer' }, text: 'hi', wait: false });
  const header = `${hhmm(NOW)} · sandman recall · 12 chars`;
  expect(await drawn($)).toEqual([`*▸ ${header}`]);
  expect(await drawn($, { press: NOW })).toEqual([`*▾ ${header}`, `~${RECALL}`, ' ']);
  expect(await drawn($, { press: NOW })).toEqual([`*▸ ${header}`]);
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
  await drawn($, { press: NOW + MINUTE + MINUTE });
  expect(await drawn($, { press: NOW })).toEqual([
    `*▾ ${hhmm(NOW + MINUTE + MINUTE)} · sandman recall · failed`,
    '~Error: printed nothing',
    ' ',
    `*▸ ${hhmm(NOW + MINUTE)} · sandman recall · 1 chars, cut`,
    `*▾ ${hhmm(NOW)} · sandman recall · 1 chars`,
    '~a',
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
