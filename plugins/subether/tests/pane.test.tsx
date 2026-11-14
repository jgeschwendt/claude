import type { On, PaneOpenArgs } from 'claude-code';
import { type Engine, type MockClock, expect, mock, test } from 'claude-code/testing';

const NOW = 1_757_000_000_000;
const COLUMNS = 160;
const BODY_COLUMNS = 60;
const BODY_ROWS = 10;
const ROWS = 40;
const MINUTE = 60_000;
const OTHER = 'theirs';
const PANE = { id: 'subether', title: 'subether · recall' };
const TODAY = Temporal.Instant.fromEpochMilliseconds(NOW)
  .toZonedDateTimeISO(Temporal.Now.timeZoneId())
  .toPlainDate()
  .toString();
const SEED = [
  'Memory from earlier sessions is yours to pull: `--type knowledge|playbook --topic <topic>`, `defer`, `done`',
  '',
  'due · deferred work: raise it with the person, never start it unasked',
  '  · 0a1b2c3d 2025-08-01 — Rerun the alpha bench (on · the box) — soon (jgeschwendt/alpha)',
  `  · 6e7f8a9b ${TODAY} — Draft the beta release notes`,
  '  · 4e5f6a7b waiting: after grove ships — Cut sandman over',
  '  … 2 more: sandman-next due',
  'always · about the person, or pinned',
  '  · Prefers short replies (user · common/user_short.md) — lead with the result',
  '  · ~Writes terse commits (user · traces/common/user_terse.md) — one line',
  'recall · add a clock to the alpha tests, then the beta · 5 of 6 · kev: embed failed',
  '.99 Alpha deploys need the vpn (project · -work-alpha/project_vpn.md) — the host is private',
  '.95 Pass a clock in (feedback · -work-alpha/feedback_clock.md) — tests take time from a clock',
  '.92 ~Beta retries back off twice (feedback · traces/-work-beta/feedback_retry.md) — then stops',
  '.90 Mock clocks drift (knowledge · knowledge/rust/mock_clocks.md) — a mock hides drift',
  '.80 ~Cut a release (playbook · traces/@rust/playbook_cut_a_release.md) — build, gate, tag',
  'read one in full: sandman-next show <path>',
].join('\n');
const STDERR = 'sandman recall: embed: exit status: 7: curl\nrecall: scorer="kev" ms=1686\n';

const hhmm = (at: number): string =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });

/**
The engine beneath: `sandman-next` printing the seed, the commands registered, the panes opened
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
  mock.env(on, { HOME: '/home/test' });
  on('command.register', ($, e) => {
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on('process.run', () => {
    const ran = { exitCode: 0, isStderrTruncated: false, isStdoutTruncated: false, stderr: STDERR };
    return { value: { ...ran, stdout: SEED } };
  });
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: 's1' }));
  on('session.start', () => ({ cwd: '/w' }));
  on('session.usage', () => ({ value: { context: { window: 0 }, rateLimits: [], startedAt: 0 } }));
  on('session.model', () => ({ value: 'm' }));
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('ui.open', ($, e) => {
    opened.push(e);
    return { value: { isPlaced: true } };
  });
  on('ui.render', () => ({ children: [OTHER], props: {}, type: 'Text' }));
  return { opened, registered, time };
};

/**
The pane drawn, after a press on the header keyed `press`, as its Text lines: `*` bold, `~` dim, `!` red
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
      `${props.weight === 'bold' ? '*' : ''}${props.dimColor === true ? '~' : ''}${props.color === undefined ? '' : '!'}${text}`,
  );
};

test('with no recall the pane says so under its header', async ($, on) => {
  engine(on);
  expect(await drawn($)).toEqual([
    '*recall · 0 pulls · 0 sent',
    '~nothing yet — the first prompt seeds it',
  ]);
});

test("the first prompt's seed is one open row: its path and time, a failed stage's cause, its due work open, overdue in orange, the always-set shut, its lines by bank or topic", async ($, on) => {
  const { time } = engine(on);
  await $.prompt.submit({ origin: { kind: 'composer' }, text: 'hi', wait: false });
  await time.settle();
  const key = `recall:${NOW}`;
  const header = `${hhmm(NOW)}  seed   add a clock to the alpha tes…  5 sent`;
  await drawn($, { press: `${key}:always` });
  expect(await drawn($, { press: `${key}:-work-alpha/feedback_clock.md` })).toEqual([
    '*recall · 1 pull · 5 sent',
    `*▾ ${header}`,
    '~  kev: embed failed · 1.7 s',
    '!  embed: exit status: 7: curl',
    '*  ▾ due · 5',
    '!      0a1b2c3d 2025-08-01 — Rerun the alpha bench (on · the box) — soon (jgeschwendt/alpha)',
    `      6e7f8a9b ${TODAY} — Draft the beta release notes`,
    '      4e5f6a7b waiting: after grove ships — Cut sandman over',
    '~      … 2 more: sandman-next due',
    '*  ▾ always · 2',
    '      Prefers short replies  user',
    '      ~Writes terse commits  user',
    '~  -work-alpha',
    '*  ▸ .99 Alpha deploys need the vpn  project',
    '*  ▾ .95 Pass a clock in  feedback',
    '~      tests take time from a clock\n      sandman-next show -work-alpha/feedback_clock.md',
    '~  traces/-work-beta',
    '*  ▸ .92 ~Beta retries back off twice  feedback',
    '~  knowledge · rust',
    '*  ▸ .90 Mock clocks drift  knowledge',
    '*  ▸ .80 ~Cut a release  playbook',
    '~  considered, not sent: 1',
  ]);
  expect(await drawn($, { press: `${key}:due` })).toContain('*  ▸ due · 5');
  expect(await drawn($, { press: key })).toEqual(['*recall · 1 pull · 5 sent', `*▸ ${header}`]);
});

test('rows are drawn newest first, the newest open: a closed-gate pull, a failed seed opened to its error', async ($, on) => {
  engine(on);
  const blocks = [
    { at: NOW, error: 'Error: exited 2: bad', session: 's1', text: '', who: 'seed' },
    {
      at: NOW + MINUTE,
      session: 's1',
      text: 'recall · hi · 0 of 6\nnothing recalled: no specific ask',
      who: 'agent',
    },
  ];
  on('state.get', async (_dollar, e, next) =>
    e.key === 'recalls' ? { value: { value: blocks, version: 1 } } : await next(e),
  );
  expect(await drawn($, { press: `recall:${NOW}` })).toEqual([
    '*recall · 2 pulls · 0 sent',
    `*▾ ${hhmm(NOW + MINUTE)}  agent  hi  0 sent`,
    '~  —',
    '~  considered, not sent: 6',
    '~  nothing recalled: no specific ask',
    `*▾ ${hhmm(NOW)}  seed   failed`,
    '!  Error: exited 2: bad',
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
