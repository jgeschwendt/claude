// End to end in this process, so the coverage counts: real daemons on port 0 under scratch state, driven through
// the CLI's `run`, the page's HTTP and WebSocket surface, and fake-hud.ts standing in for hud.
import { afterEach, expect, test } from 'bun:test';
import { validate } from './catalog.tsx';
import { FIX, VERSION, plist, run } from './cli.ts';
import { lit } from './lit.ts';
import { serve } from './server.tsx';

const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } =
  process.getBuiltinModule('node:fs');

const BAD_REQUEST = 400;
/**
setup's tries at `launchctl bootstrap`, and the time they may take
*/
const BOOTSTRAP_TRIES = 20;
const BOOTSTRAP_MS = 10_000;
/**
how long a request is held before its socket is cut
*/
const CUT_AFTER_MS = 50;
const DIR = import.meta.dir;
const EXAMPLE = `${DIR}/example.json`;
const EXECUTABLE = 0o755;
const FORBIDDEN = 403;
const PLAN = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
/**
the characters of an id the CLI prints
*/
const ID_SHORT = 8;
/**
how many times a browser call is looked for before it is called missing
*/
const LANDED_TRIES = 100;
/**
the daemon's log rotates past this size
*/
const LOG_CAP = 1_048_576;
/**
a pause long enough for a stop or a signal to drain
*/
const LONG_MS = 100;
const NOT_FOUND = 404;
const OK = 200;
/**
the field that tells an event its place in the plan's log
*/
const POSITION = 'n';
/**
a slow reply, so a cut socket lands first
*/
const SLOW_MS = 500;
/**
a pause long enough for a request in flight to arrive
*/
const SHORT_MS = 50;
/**
the leading characters of a thread id a reply may name
*/
const THREAD_PREFIX = 6;
/**
the states a machine's walk visits, so the animated ones
*/
const VISITED = 3;
const stops: (() => Promise<void>)[] = [];
Reflect.deleteProperty(Bun.env, 'CLAUDE_CODE_SESSION_ID');
Object.assign(Bun.env, { SHOW_NO_BROWSER: '1' });

/**
the scratch state directory the next daemon and CLI use
*/
const stateHome = (): string => {
  const { XDG_STATE_HOME } = Bun.env;
  return `${XDG_STATE_HOME}`;
};

/**
a daemon on a fresh state directory (short, for the Unix socket's path limit)
*/
const boot = async (
  hud = `${DIR}/fake-hud.ts`,
): Promise<{ root: string; stop: (reason: string) => Promise<void>; url: string }> => {
  Object.assign(Bun.env, { SHOW_HUD: hud, XDG_STATE_HOME: mkdtempSync('/tmp/show-') });
  const daemon = await serve({ port: 0 });
  stops.push(() => daemon.stop('test'));
  return { ...daemon, root: `${stateHome()}/show` };
};
const show = (...argv: string[]): Promise<[number, string]> => run(argv);
/**
what a CLI call printed
*/
const said = async (...argv: string[]): Promise<string> => {
  const [, text] = await show(...argv);
  return text;
};
/**
what a CLI call printed, read as JSON
*/
const parsed = async (...argv: string[]): Promise<unknown> => JSON.parse(await said(...argv));
const json = (body: unknown, origin?: string): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(origin && { origin }) },
  method: 'POST',
});
const control = (path: string, version = VERSION): Promise<Response> =>
  fetch(`http://show${path}`, {
    headers: { 'x-show-version': version },
    unix: `${stateHome()}/show/show.sock`,
  });
/**
the body of a response, read as text
*/
const textOf = async (response: Promise<Response>): Promise<string> => {
  const settled = await response;
  return settled.text();
};
/**
the body of a response, read as JSON
*/
const jsonOf = async <Body>(response: Promise<Response>): Promise<Body> => {
  const settled = await response;
  return settled.json();
};
/**
the status of a response
*/
const statusOf = async (response: Promise<Response>): Promise<number> => {
  const settled = await response;
  return settled.status;
};
/**
what a second daemon on the same state refuses with
*/
const refused = async (): Promise<string[]> => {
  try {
    await serve({ port: 0 });
    return [];
  } catch (error) {
    const { code, message } = error as { code: string; message: string };
    return [code, message];
  }
};
const opened = async (): Promise<string> => {
  await boot();
  return said('open', EXAMPLE);
};

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

const lean = { label: 'x', lean: true };
/**
a machine config of one state
*/
const IDLE = { initial: 'idle', states: { idle: {} } };
/**
a titled machine part with `own` props
*/
/**
a hud thread as the store holds it, pinned to `selector` on the old plan's page
*/
const onOld = (id: string, selector: string): object => ({
  id,
  messages: [],
  page: '/old',
  selector,
  status: 'open',
});
const machine = (own: object): unknown[] => ['machine', { title: 't', ...own }];
const choice = (id: string, extra: object = {}): unknown[] => [
  'choice',
  { id, options: { yes: lean }, ...extra },
];

test('validate names the question and the field of every problem', () => {
  expect(validate(PLAN)).toEqual([]);
  expect(validate([])).toEqual(['plan: Expected length 3, received 0']);
  expect(validate('x')).toEqual(['plan: Expected tuple, received "x"']);
  expect(validate(['t', 'nope', { first: ['t', 'nope'] }])).toEqual([
    'overview: Expected list, received "nope"',
    'first.body: Expected list, received "nope"',
  ]);
  expect(validate(['t', [], []])).toEqual(['questions: Expected record, received list']);
  expect(
    validate(['t', [], { first: ['t', [['code', { code: 'x' }, 1]]], second: ['t', 'x', 1] }]),
  ).toEqual([
    'first.body[0] code: Expected length 2, received 3',
    'second: Expected length 2, received 3',
  ]);
  // a kind it does not know is told from a mistake in a kind it does, and the choice is never in the overview
  expect(
    validate([
      '',
      [['gauge', {}], ['choice', { id: 'c', options: { yes: lean }, title: 't' }], 'x'],
      { first: ['t', [['nope', 1], 'x']] },
    ]),
  ).toEqual([
    'overview[0] gauge.kind: Expected one of chart | code | compare | figure | list | machine | note | tabs, received "gauge"',
    'overview[1] choice.kind: Expected one of chart | code | compare | figure | list | machine | note | tabs, received "choice"',
    'overview[2]: Expected tuple, received "x"',
    'first.body[0] nope.kind: Expected one of chart | code | compare | figure | list | machine | note | tabs | choice, received "nope"',
    'first.body[1]: Expected tuple, received "x"',
  ]);
  expect(
    validate([
      '',
      [
        ['note', { text: 'fine' }],
        ['chart', { kind: 'pie', rows: [['l', -1], ['x']], title: 't' }],
        ['code', { code: 'x', lang: 'nope', title: 't' }],
        ['compare', { pair: ['a'], title: 't' }],
        ['figure', { title: 't' }],
        ['list', { items: [], title: 't' }],
        ['machine', { machine: 'five', title: 't' }],
        ['machine', { id: 'x', loop: false, machine: ['a'], title: 't' }],
        ['machine', { loop: true, machine: IDLE, title: 't' }],
        ['tabs', { tabs: [['a', 'b']], title: 't' }],
        [
          'tabs',
          {
            tabs: [
              ['same', 'a'],
              ['same', 'b'],
            ],
            title: 't',
          },
        ],
        [
          'tabs',
          {
            tabs: [
              ['one', 'a', 'nope'],
              ['two', 'b'],
            ],
            title: 't',
          },
        ],
        [
          'tabs',
          {
            tabs: [
              ['one', 'a', 'rust', 'x'],
              ['two', 'b'],
            ],
            title: 't',
          },
        ],
        ['code', { code: 'x' }],
      ],
      {
        alpha: ['', []],
        bravo: [
          't',
          [
            ['note', { text: 't', title: '' }],
            ['note', { text: 'fine' }],
          ],
        ],
        charlie: ['t', [['choice', { hint: 'h', id: 'm', options: { yes: lean }, pick: 'many' }]]],
        delta: ['t', [['choice', { id: 'p', options: { yes: lean }, pick: 'some' }]]],
        echo: ['t', [['choice', { id: 's', options: { yes: { ...lean, shape: '' } } }]]],
        foxtrot: ['t', [['choice', { id: '1', options: {} }]]],
        golf: ['t', [['choice', { id: 'n', options: { '7': lean } }]]],
      },
    ]),
  ).toEqual([
    'title: Expected a non-empty string',
    'overview[1] chart.kind: Expected one of bar | split, received "pie"',
    'overview[1] chart.rows[0][1]: Expected a number ≥ 0',
    'overview[1] chart.rows[1]: Expected length 2, received 1',
    'overview[2] code.lang: Expected a shiki language id, such as "rust" or "sh"',
    'overview[3] compare.pair: Expected length 2, received 1',
    'overview[4] figure.svg: Expected String, missing',
    'overview[5] list.items: Expected at least one',
    'overview[6] machine.machine: Expected machine, received "five"',
    'overview[7] machine.loop: Expected true, received false',
    'overview[7] machine.id: Unknown field on machine',
    'overview[8] machine: Expected loop only with a list of steps',
    'overview[9] tabs.tabs: Expected at least two tabs with distinct labels',
    'overview[10] tabs.tabs: Expected at least two tabs with distinct labels',
    'overview[11] tabs.tabs: Expected each tab language a shiki language id, such as "rust" or "sh"',
    'overview[12] tabs.tabs[0]: Expected tab, received list',
    'overview[13] code: Expected a title',
    'alpha.title: Expected a non-empty string',
    'bravo.body[0] note.title: Expected a non-empty string',
    'charlie.body[0] choice.hint: Unknown field on choice',
    'delta.body[0] choice.pick: Expected one of many | one, received "some"',
    'echo.body[0] choice.options.yes.shape: Expected a non-empty string',
    'foxtrot.body[0] choice.id: Expected a letter, then letters, digits, - or _',
    'foxtrot.body[0] choice.options: Expected at least one option, each value not a whole number (JS orders those first)',
    'golf.body[0] choice.options: Expected at least one option, each value not a whole number (JS orders those first)',
  ]);
});

test('validate holds a plan to the rules its fields cannot say alone', () => {
  const idle = machine({ machine: IDLE });
  const noQuestions =
    'Expected at least one question, each id a letter, then letters, digits, - or _';
  expect(validate(['t', [], {}])).toEqual([`questions: ${noQuestions}`]);
  expect(validate(['t', [], { 1: ['t', []] }])).toEqual([`questions: ${noQuestions}`]);
  expect(validate(['t', [], { 'a b': ['t', []] }])).toEqual([`questions: ${noQuestions}`]);
  expect(
    validate([
      't',
      [['machine', { loop: true, machine: ['a'], title: 't' }], idle],
      {
        alpha: ['t', [choice('one', { options: { yes: { label: 'x' } } })]],
        bravo: ['t', [choice('two', { pick: 'many' })]],
        charlie: ['t', [choice('six', { options: { no: lean, yes: { label: 'y', lean: true } } })]],
        delta: ['t', [['machine', { loop: true, machine: IDLE }]]],
        echo: ['t', [choice('same'), choice('same'), choice('other')]],
        foxtrot: ['t', [choice('one', { title: 'Two choices' }), choice('two')]],
        golf: ['t', []],
      },
    ]),
  ).toEqual([
    'alpha.body[0] choice: Expected exactly one lean option unless pick is "many"',
    'charlie.body[0] choice: Expected exactly one lean option unless pick is "many"',
    'delta.body[0] machine: Expected loop only with a list of steps',
    'echo: Expected choice ids distinct',
  ]);
});

test('validate asks xstate once the fields check, naming the machine and its field', () => {
  const states = { busy: {}, idle: { on: { GO: 'busy', STAY: 'idle' } } };
  const gone = { initial: 'gone', states: { idle: {} } };
  expect(
    validate([
      'f',
      [
        machine({
          machine: { initial: 'idle', states: { idle: { initial: 'busy', states: { busy: {} } } } },
        }),
        machine({ machine: gone }),
        machine({ machine: { initial: 'idle', states }, walk: ['STAY', 'NOPE'] }),
        machine({ machine: ['a', 'b'], walk: ['next', 'next'] }),
        machine({
          machine: {
            initial: 'idle',
            states: { busy: { type: 'final' }, idle: { on: { GO: 'busy' } } },
          },
          walk: ['GO'],
        }),
        machine({ machine: { initial: 'idle', states: { idle: { on: { GO: 'nowhere' } } } } }),
      ],
      { kept: ['t', [machine({ machine: gone }), ['note', { text: 'n' }]]] },
    ]),
  ).toEqual([
    'overview[0] machine.config: state "idle" is compound; nested, parallel and history states are not drawn, so flatten the machine',
    'overview[1] machine.config: Initial state node "gone" not found on parent state node #(machine)',
    'overview[2] machine.walk: "NOPE" is not an event from "idle" (it takes: GO, STAY)',
    'overview[3] machine.walk: "next" is not an event from "b" (it takes: nothing)',
    "overview[5] machine.config: Invalid transition definition for state node '(machine).idle':\nChild state 'nowhere' does not exist on '(machine)'",
    'kept.body[0] machine.config: Initial state node "gone" not found on parent state node #(machine)',
  ]);
});

test('a machine without a walk goes down its longest simple path; a shorthand chain wraps tall', async () => {
  const [, overview, questions] = await lit([
    'f',
    [
      [
        'machine',
        {
          machine: {
            initial: 'first',
            states: {
              first: { on: { SHORT: 'last', STEP: 'middle' } },
              last: {},
              lone: {},
              middle: { on: { STEP: 'last' } },
            },
          },
          title: 'long',
        },
      ],
      ['machine', { machine: ['one & <two>', 'three', 'four', 'five', 'six'], title: 'shorthand' }],
    ],
    {
      drawn: [
        't',
        [
          ['machine', { machine: ['a', 'b'] }],
          ['note', { text: 't' }],
        ],
      ],
      plain: ['t', []],
    },
  ] as never);
  const [long, chain] = overview.map(([, own]) => (own as { svg: string }).svg);
  // first, middle and last lit in turn; lone, never visited, never animated
  expect(long).toContain("values='0.35;0;0'");
  expect(long).toContain("values='0;0;0.35'");
  expect(long?.match(/<animate /gu)).toHaveLength(VISITED);
  expect(long).toContain('>STEP</text>');
  // unlabelled edges, escaped names, and the taller layout once the chain outgrows the page
  expect(chain).toContain('one &amp; &lt;two&gt;');
  expect(chain).not.toContain('>next</text>');
  expect(chain).toMatch(/viewBox='0 0 \d+ \d+'/u);
  // a question's body is drawn too, the other contexts and a question without a body left alone
  const { drawn, plain } = questions;
  expect(JSON.stringify(drawn)).toContain('"svg":"<svg ');
  expect(drawn?.[1].at(-1)).toEqual(['note', { text: 't' }]);
  expect(plain).toEqual(['t', []]);
});

test('a plan stored as a form is converted once on boot: its answers, its file and its hud threads', async () => {
  const old = {
    cards: [
      {
        body: [
          {
            component: 'compare',
            lang: 'rust',
            pair: ['let a = 1;', 'let b = 1;'],
            text: 'caption',
          },
          { component: 'chart', kind: 'bar', rows: [{ label: 'r', value: 2 }], title: 'R' },
          {
            component: 'code',
            tabs: [
              { code: 'a', label: 'one', lang: 'rust' },
              { code: 'b', label: 'two' },
            ],
            title: 'Tabs',
          },
          { component: 'machine', config: IDLE, title: 'M' },
          { component: 'machine', items: ['a', 'b'], loop: true },
          { component: 'list', items: ['x'], title: 'L' },
          { component: 'note', text: 'kept' },
          {
            component: 'choice',
            id: 'pick',
            options: [
              { label: 'a', lean: true, value: 'yes' },
              { hint: 'h', label: 'b', shape: 'M0 0', value: 'no' },
            ],
            pick: 'one',
            title: 'T',
          },
        ],
        id: 'one',
        meta: 'm',
        text: 'lead',
        title: 'One',
      },
    ],
    overview: [
      { component: 'note', text: 'kept', title: 'K' },
      { component: 'figure', svg: '<svg/>', text: 'cap', title: 'F' },
    ],
    text: 'intro',
    title: 'Old form',
  };
  Object.assign(Bun.env, {
    SHOW_HUD: `${DIR}/fake-hud.ts`,
    XDG_STATE_HOME: mkdtempSync('/tmp/show-'),
  });
  const root = `${stateHome()}/show`;
  const stored = `${root}/old`;
  const status = JSON.stringify({ lines: [], opened: 'x', resolved: ['one'], session: 's' });
  mkdirSync(stored, { recursive: true });
  mkdirSync(`${root}/bare`);
  writeFileSync(`${stored}/form.json`, JSON.stringify(old));
  writeFileSync(`${stored}/status.json`, status);
  writeFileSync(
    `${root}/bare/form.json`,
    JSON.stringify({ cards: [{ id: 'solo', title: 'C' }], title: 'Bare' }),
  );
  writeFileSync(`${root}/bare/status.json`, status);
  writeFileSync(`${root}/bare/answers.jsonl`, '');
  const current = ['answer', { at: 'x', message: 'already', question: 'one' }];
  const before = [
    {
      at: 'x',
      card: 'one',
      kind: 'answer',
      message: 'm',
      notes: { pick: { yes: 'why' } },
      picks: { pick: ['yes'] },
    },
    { at: 'x', kind: 'comment', text: 'hud', thread: 't1' },
    { at: 'x', card: 'one', kind: 'comment', text: 'on one', thread: 't2' },
    { at: 'x', card: 'one', kind: 'resolve' },
    current,
  ];
  writeFileSync(
    `${stored}/answers.jsonl`,
    before.map((line) => `${JSON.stringify(line)}\n`).join(''),
  );
  writeFileSync(
    `${root}/threads.json`,
    JSON.stringify(
      [onOld('t1', '#card-one'), onOld('t2', 'h1'), onOld('t3', '#card-one > p')],
      undefined,
      1,
    ),
  );
  const daemon = await serve({ port: 0 });
  stops.push(() => daemon.stop('test'));
  expect(existsSync(`${stored}/form.json`)).toBe(false);
  expect(existsSync(`${root}/bare/form.json`)).toBe(false);
  // every answer is a tuple with its `question`, the one already current left as it was
  const after = readFileSync(`${stored}/answers.jsonl`, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(after).toEqual([
    [
      'answer',
      {
        at: 'x',
        message: 'm',
        notes: { pick: { yes: 'why' } },
        picks: { pick: ['yes'] },
        question: 'one',
      },
    ],
    ['comment', { at: 'x', text: 'hud', thread: 't1' }],
    ['comment', { at: 'x', question: 'one', text: 'on one', thread: 't2' }],
    ['resolve', { at: 'x', question: 'one' }],
    current,
  ]);
  expect(await parsed('wait', 'old')).toMatchObject(after[0]);
  // the plan: the form's text, a caption and a question's meta and text leading notes, components as parts
  const migrated = JSON.parse(readFileSync(`${stored}/plan.json`, 'utf8'));
  expect(migrated).toEqual([
    'Old form',
    [
      ['note', { text: 'intro' }],
      ['note', { text: 'kept', title: 'K' }],
      ['note', { text: 'cap' }],
      ['figure', { svg: '<svg/>', title: 'F' }],
    ],
    {
      one: [
        'One',
        [
          ['note', { text: 'm' }],
          ['note', { text: 'lead' }],
          ['note', { text: 'caption' }],
          ['compare', { lang: 'rust', pair: ['let a = 1;', 'let b = 1;'] }],
          ['chart', { kind: 'bar', rows: [['r', 2]], title: 'R' }],
          [
            'tabs',
            {
              tabs: [
                ['one', 'a', 'rust'],
                ['two', 'b'],
              ],
              title: 'Tabs',
            },
          ],
          ['machine', { machine: IDLE, title: 'M' }],
          ['machine', { loop: true, machine: ['a', 'b'] }],
          ['list', { items: ['x'], title: 'L' }],
          ['note', { text: 'kept' }],
          [
            'choice',
            {
              id: 'pick',
              options: {
                no: { hint: 'h', label: 'b', shape: 'M0 0' },
                yes: { label: 'a', lean: true },
              },
              pick: 'one',
              title: 'T',
            },
          ],
        ],
      ],
    },
  ]);
  expect(validate(migrated)).toEqual([]);
  expect(JSON.parse(readFileSync(`${root}/bare/plan.json`, 'utf8'))).toEqual([
    'Bare',
    [],
    { solo: ['C', []] },
  ]);
  // hud's threads follow the page's new selector, the ones that were never a card's left alone
  expect(
    JSON.parse(readFileSync(`${root}/threads.json`, 'utf8')).map(
      ({ selector }: { selector: string }) => selector,
    ),
  ).toEqual(['#question-one', 'h1', '#question-one > p']);
  // served, with its resolved question and its answer
  const page = await textOf(fetch(`${daemon.url}old`));
  expect(page).toContain('caption');
  expect(page).toContain('✓ One<!-- --> · already');
  expect(await said('list')).toContain('Old form · 0 his turn');
  // the old shape is never accepted again
  const stale = `${stateHome()}/stale.json`;
  writeFileSync(stale, JSON.stringify(old));
  expect(await show('open', stale)).toEqual([
    1,
    expect.stringContaining('plan: Expected tuple, received'),
  ]);
  expect(await show('update', 'old', stale)).toEqual([
    1,
    expect.stringContaining('plan: Expected tuple, received'),
  ]);
});

test('the CLI says plainly when the daemon is down, and its usage', async () => {
  Object.assign(Bun.env, { XDG_STATE_HOME: mkdtempSync('/tmp/show-') });
  expect(await show('list')).toEqual([1, expect.stringMatching(/^show: down: no daemon on/u)]);
  expect(await said()).toStartWith('show: usage: show close <slug>\n  show health');
  const [code] = await show('reply', 'x');
  expect(code).toBe(1);
  expect(await show('open', '/nope.json')).toEqual([
    1,
    expect.stringMatching(/^show: invalid: \/nope\.json: /u),
  ]);
});

test('a request cut off mid-flight is outcome unknown, never retried', async () => {
  const root = mkdtempSync('/tmp/show-');
  mkdirSync(`${root}/show`);
  const cut = Bun.serve({
    fetch: async () => {
      setTimeout(() => cut.stop(true), CUT_AFTER_MS);
      await Bun.sleep(SLOW_MS);
      return new Response('late');
    },
    unix: `${root}/show/show.sock`,
  });
  Object.assign(Bun.env, { XDG_STATE_HOME: root });
  expect(await show('close', 'x')).toEqual([
    1,
    expect.stringMatching(/^show: unknown: outcome unknown: /u),
  ]);
});

test('boots, refuses a second instance, reports its version and rotates its log', async () => {
  Object.assign(Bun.env, {
    SHOW_HUD: `${DIR}/fake-hud.ts`,
    XDG_STATE_HOME: mkdtempSync('/tmp/show-'),
  });
  mkdirSync(`${stateHome()}/show`);
  writeFileSync(`${stateHome()}/show/show.log`, 'x'.repeat(LOG_CAP + 1));
  const booting = serve({ port: 0 });
  const { state: booted } = (await parsed('health')) as { state: string };
  expect(booted).toBe('booting');
  expect(await show('list')).toEqual([1, 'show: booting: show is booting']);
  const daemon = await booting;
  stops.push(() => daemon.stop('test'));
  const second = await refused();
  expect(second).toEqual([
    'running',
    `another show holds ${stateHome()}/show/show.lock (pid ${process.pid})`,
  ]);
  expect(await parsed('health')).toEqual({
    pid: process.pid,
    reason: '',
    state: 'ready',
    url: daemon.url,
    version: VERSION,
  });
  expect(existsSync(`${stateHome()}/show/show.log.1`)).toBe(true);
  expect(await jsonOf(control('/plans', 'old'))).toEqual({
    error: { code: 'version', message: `daemon runs ${VERSION}, this CLI is old: ${FIX}` },
  });
  expect(await statusOf(control('/nope'))).toBe(NOT_FOUND);
  expect(await show('list')).toEqual([0, 'no open plans']);
});

test('without hud it runs degraded, and replies say why', async () => {
  const { url } = await boot(`${DIR}/missing.ts`);
  const { reason, state } = (await parsed('health')) as { reason: string; state: string };
  expect([state, reason]).toEqual(['degraded', expect.stringMatching(/^hud: /u)]);
  await show('open', EXAMPLE);
  expect(await show('reply', 'lints-canon', 'land', 'hi')).toEqual([
    1,
    expect.stringMatching(/^show: hud_off: threads are off: hud: /u),
  ]);
  expect(await textOf(fetch(`${url}lints-canon`))).toContain('<h1>Lints canon</h1>');
});

test('open validates, registers and lists; the page renders it; Host and Origin are checked', async () => {
  const url = await opened();
  expect(url).toEndWith('/lints-canon');
  expect(await show('open', EXAMPLE)).toEqual([
    1,
    'show: exists: lints-canon is open: show update lints-canon <plan.json>, or open with --slug',
  ]);
  const bad = `${stateHome()}/bad.json`;
  writeFileSync(bad, JSON.stringify(['t', [], {}]));
  expect(await show('open', bad, '--slug', 'Bad Slug')).toEqual([
    1,
    'show: invalid: questions: Expected at least one question, each id a letter, then letters, digits, - or _\nslug "Bad Slug": lowercase letters, digits and -',
  ]);
  expect(await show('list')).toEqual([
    0,
    `${url}  Lints canon · 6 his turn · 0 waiting on the agent · 0 agent working · `,
  ]);
  const page = await textOf(fetch(url));
  expect(page).toContain('allow in canon<!-- --> ★');
  // a question's body, each item under a small heading only when it has a title
  expect(page).toContain('<div class="part"><h3>Steps</h3><ul>');
  expect(page).toContain('<div class="part"><div class="pair">');
  expect(page).toContain('Cost: 39 renames in routines');
  expect(page).toContain(`<div class="figure"><svg viewBox='0 0 400 80'`);
  // drawn on the server, in the state the page hydrates from
  expect(page).toContain('<div class="machine"><svg ');
  expect(page).toContain(String.raw`"svg":"<svg `);
  expect(page).toContain('window.__SHOW__={');
  // highlighted on the server, in the state the page hydrates from, uncoloured by anything but variables
  expect(page).toContain('<div class="lit"><pre class="shiki css-variables"');
  expect(page).toContain('color:var(--shiki-token-keyword)');
  expect(page).toContain(String.raw`"html":["<pre class=\"shiki css-variables\"`);
  // a tabs context: the bar, the first tab's highlighted sample, and an HTML entry per tab (plain is empty)
  expect(page).toContain('<div class="tablist" role="tablist"><button aria-selected="true"');
  expect(page).toContain('<div role="tabpanel"><div class="lit">');
  expect(page).toContain('</pre>",""]');
  const index = await fetch(url.replace('lints-canon', ''));
  expect(await index.text()).toContain('Lints canon');
  const missing = await fetch(url.replace('lints-canon', 'gone'));
  expect([missing.status, await missing.text()]).toEqual([
    NOT_FOUND,
    expect.stringContaining('No open plan at /gone'),
  ]);
  const script = await fetch(url.replace('lints-canon', 'client.js'));
  expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  const style = await fetch(url.replace('lints-canon', 'style.css'));
  expect(await style.text()).toContain('--glass');
  const evil = json({}, 'http://evil.test');
  expect(await statusOf(fetch(url, { headers: { host: 'evil.test' } }))).toBe(FORBIDDEN);
  expect(await statusOf(fetch(`${url}/answer`, evil))).toBe(FORBIDDEN);
  expect(await statusOf(fetch(url, { headers: { upgrade: 'websocket' } }))).toBe(BAD_REQUEST);
});

test('answers are checked, recorded, waited for once each, and pushed over the socket', async () => {
  const url = await opened();
  const origin = url.replace(/\/lints-canon$/u, '');
  const answer = (body: object): Promise<Response> => fetch(`${url}/answer`, json(body, origin));
  expect(await statusOf(answer({ question: 'nope' }))).toBe(NOT_FOUND);
  expect(
    await statusOf(
      fetch(`${url}/answer`, { body: 'not json', headers: { origin }, method: 'POST' }),
    ),
  ).toBe(NOT_FOUND);
  const wrong = {
    error: { code: 'invalid', message: 'choose land: land, hold, or write a message' },
  };
  // an unknown value or choice, nothing, two picks on a pick-one choice, a repeated pick, a stranger's shape
  expect(
    await Promise.all(
      [
        { picks: { land: ['maybe'] } },
        { message: ' ' },
        { picks: { land: ['land', 'hold'] } },
        { picks: { land: ['hold', 'hold'] } },
        { picks: { elsewhere: ['land'] } },
        { picks: { land: {} } },
        { picks: 'land' },
      ].map((body) => jsonOf(answer({ question: 'land', ...body }))),
    ),
  ).toEqual([wrong, wrong, wrong, wrong, wrong, wrong, wrong]);
  expect(await jsonOf(answer({ message: ' ', question: 'else' }))).toEqual({
    error: { code: 'invalid', message: 'write a message' },
  });
  const socket = new WebSocket(url.replace('http', 'ws'));
  const frames: { events?: unknown[]; status?: unknown }[] = [];
  socket.addEventListener('message', ({ data }) => {
    frames.push(JSON.parse(String(data)));
  });
  await new Promise((resolve) => {
    socket.addEventListener('open', resolve);
  });
  expect(
    await statusOf(
      answer({ message: ' look first ', picks: { land: ['hold'] }, question: 'land' }),
    ),
  ).toBe(OK);
  expect(await parsed('wait', 'lints-canon')).toEqual([
    'answer',
    {
      [POSITION]: 0,
      at: expect.any(String),
      message: 'look first',
      picks: { land: ['hold'] },
      question: 'land',
    },
  ]);
  const next = parsed('wait', 'lints-canon');
  await Bun.sleep(SHORT_MS);
  await answer({ message: 'ship it', question: 'else' });
  expect(await next).toMatchObject([
    'answer',
    { [POSITION]: 1, message: 'ship it', question: 'else' },
  ]);
  // his own words alone answer a question with choices: no picks key
  await answer({ message: 'both, staged', question: 'land' });
  expect(await parsed('wait', 'lints-canon')).toEqual([
    'answer',
    { [POSITION]: 2, at: expect.any(String), message: 'both, staged', question: 'land' },
  ]);
  // a pick-many choice: picks in authored order, and only the option comments he wrote, for options and choices
  // the question has
  await answer({
    notes: { elsewhere: { other: 'y' }, rules: { ascii: ' ', docs: ' later ', zzz: 'x' } },
    picks: { rules: ['ascii', 'numeric'] },
    question: 'allow',
  });
  expect(await parsed('wait', 'lints-canon')).toMatchObject([
    'answer',
    { notes: { rules: { docs: 'later' } }, picks: { rules: ['numeric', 'ascii'] } },
  ]);
  // two choices in one answer: each pick-one at most one value, each list in authored order; a choice with nothing
  // picked is left out, and a note alone is an answer
  const two = answer({
    picks: { keep: ['drop'], where: ['tests', 'canon'] },
    question: 'attribute',
  });
  expect(await statusOf(two)).toBe(OK);
  expect(await parsed('wait', 'lints-canon')).toMatchObject([
    'answer',
    { picks: { keep: ['drop'], where: ['canon', 'tests'] }, question: 'attribute' },
  ]);
  await answer({
    notes: { keep: { keep: 'because' } },
    picks: { where: [] },
    question: 'attribute',
  });
  expect(await parsed('wait', 'lints-canon')).toEqual([
    'answer',
    {
      [POSITION]: expect.any(Number),
      at: expect.any(String),
      notes: { keep: { keep: 'because' } },
      question: 'attribute',
    },
  ]);
  socket.send('the page never speaks on its socket');
  await Bun.sleep(SHORT_MS);
  expect(frames.at(-1)?.events?.at(-1)).toMatchObject([
    'answer',
    { notes: { keep: { keep: 'because' } } },
  ]);
  expect(await show('status', 'lints-canon', 'one', 'two')).toEqual([
    0,
    'status lints-canon: 2 lines',
  ]);
  await Bun.sleep(SHORT_MS);
  expect(frames.at(-1)?.status).toMatchObject({
    at: expect.any(String),
    lines: ['one', 'two'],
  });
  expect(await textOf(fetch(url))).toContain('<li>two</li>');
  socket.close();
});

test('threads: the owner speaks on hud, the agent replies and resolves', async () => {
  const url = await opened();
  const say = (body: object): Promise<{ id: string }> =>
    jsonOf(fetch(url.replace('lints-canon', '__hud/say'), json(body)));
  expect(await show('reply', 'lints-canon', 'land', 'hi')).toEqual([
    1,
    'show: no_thread: the owner has not written on land yet',
  ]);
  await fetch(`${url}/answer`, json({ picks: { land: ['land'] }, question: 'land' }));
  const thread = await say({
    page: '/lints-canon',
    selector: '#question-land',
    text: 'land: land as it is',
  });
  const pinned = await say({ page: '/lints-canon', selector: 'h1', text: 'nice title' });
  await say({ page: '/elsewhere', selector: 'h1', text: 'not a form' });
  expect(await parsed('wait', 'lints-canon')).toMatchObject([
    'answer',
    { [POSITION]: 0, picks: { land: ['land'] } },
  ]);
  expect(await parsed('wait', 'lints-canon')).toMatchObject([
    'comment',
    { [POSITION]: 1, text: 'nice title', thread: pinned.id },
  ]);
  // counts are questions: a comment on the title is no question's
  expect(await said('list')).toContain('· 5 his turn · 1 waiting on the agent · 0 agent working ·');
  expect(await show('reply', 'lints-canon', 'land', '--working', 'landing', 'now')).toEqual([
    0,
    `replied ${thread.id.slice(0, ID_SHORT)}`,
  ]);
  expect(await said('list')).toContain('· 5 his turn · 0 waiting on the agent · 1 agent working ·');
  expect(await textOf(fetch(url))).toContain('<section class="working"><h2>Agent working · 1</h2>');
  expect(await show('reply', 'lints-canon', pinned.id.slice(0, THREAD_PREFIX), 'thanks')).toEqual([
    0,
    `replied ${pinned.id.slice(0, ID_SHORT)}`,
  ]);
  expect(await said('reply', 'lints-canon', '', 'x')).toStartWith(
    'show: ambiguous: 2 threads match',
  );
  expect(await said('reply', 'lints-canon', 'zzz', 'x')).toStartWith(
    'show: not_found: 0 threads match zzz',
  );
  expect(await show('reply', 'lints-canon', 'land', ' ')).toEqual([
    1,
    'show: invalid: nothing to say',
  ]);
  await say({ id: thread.id, page: '/lints-canon', selector: '#question-land', text: 'and then?' });
  expect(await parsed('wait', 'lints-canon')).toMatchObject([
    'comment',
    { question: 'land', text: 'and then?' },
  ]);
  // his word on a working question makes it wait on the agent; a plain reply hands it back to him
  expect(await said('list')).toContain('· 5 his turn · 1 waiting on the agent · 0 agent working ·');
  await said('reply', 'lints-canon', 'land', 'landed: your call');
  expect(await said('list')).toContain('· 6 his turn · 0 waiting on the agent · 0 agent working ·');
  expect(await show('resolve', 'lints-canon', 'land')).toEqual([0, 'resolved land']);
  expect(await show('resolve', 'lints-canon', pinned.id)).toEqual([0, `resolved ${pinned.id}`]);
  expect(await show('resolve', 'lints-canon', thread.id)).toEqual([0, 'resolved land']);
  expect(await show('resolve', 'lints-canon', 'zzz')).toEqual([
    1,
    'show: not_found: no question or thread zzz on lints-canon',
  ]);
  const stray = fetch(`${url}/resolve`, json({ question: 'zzz' }));
  expect(await textOf(stray)).toContain('no question zzz on lints-canon');
  const page = await textOf(fetch(url));
  expect(page).toContain('<a class="back" href="/">← All plans</a>');
  expect(page).toContain('Resolved · 1');
  expect(page).toContain('✓ jlg.io harness<!-- --> · land as it is');
  expect(await said('list')).toContain('· 5 his turn · 0 waiting');
  await fetch(`${url}/answer`, json({ picks: { land: ['hold'] }, question: 'land' }));
  expect(await said('list')).toContain('· 6 his turn · 0 waiting');
});

test('update, status, close and the routes that refuse', async () => {
  const url = await opened();
  const changed = `${stateHome()}/changed.json`;
  writeFileSync(changed, JSON.stringify(['Lints canon, again', ...PLAN.slice(1)]));
  expect(await show('update', 'lints-canon', changed)).toEqual([0, url]);
  writeFileSync(changed, '[]');
  expect(await said('update', 'lints-canon', changed)).toStartWith(
    'show: invalid: plan: Expected length 3, received 0',
  );
  expect(await show('update', 'nope', EXAMPLE)).toEqual([1, 'show: not_found: no open plan nope']);
  const socket = `${stateHome()}/show/show.sock`;
  const refusal = await jsonOf(
    fetch('http://show/plans/lints-canon/status', {
      body: '{"lines":[1]}',
      headers: { 'x-show-version': VERSION },
      method: 'PUT',
      unix: socket,
    }),
  );
  expect(refusal).toEqual({
    error: { code: 'invalid', message: 'lines: expected [string, …]' },
  });
  const waiting = show('wait', 'lints-canon');
  await Bun.sleep(SHORT_MS);
  expect(await show('close', 'lints-canon')).toEqual([0, 'closed lints-canon']);
  expect(await waiting).toEqual([1, 'show: not_found: lints-canon was closed']);
  expect(await show('list')).toEqual([0, 'no open plans']);
  expect(await show('open', EXAMPLE)).toEqual([0, url]);
});

test('open and update show the plan in the browser, unless told not to', async () => {
  const { root } = await boot();
  const opener = `${root}/opener`;
  const seen = `${root}/opened`;
  writeFileSync(opener, `#!/bin/sh\necho "$1" >> ${seen}\n`);
  chmodSync(opener, EXECUTABLE);
  const snapshot = (): string[] =>
    (existsSync(seen) ? readFileSync(seen, 'utf8') : '').split('\n').filter(Boolean);
  // an opener runs on its own schedule: wait for the call to land, or for long enough that none will
  const landed = async (count: number, tries = 0): Promise<string[]> => {
    await Bun.sleep(SHORT_MS);
    const lines = snapshot();
    return lines.length >= count || tries >= LANDED_TRIES ? lines : landed(count, tries + 1);
  };
  const quiet = async (): Promise<string[]> => {
    await Bun.sleep(LONG_MS);
    return snapshot();
  };
  Reflect.deleteProperty(Bun.env, 'SHOW_NO_BROWSER');
  Object.assign(Bun.env, { SHOW_OPENER: opener });
  try {
    const [, url] = await show('open', EXAMPLE);
    expect(await landed(1)).toEqual([url]);
    await show('update', 'lints-canon', EXAMPLE);
    expect(await landed(2)).toEqual([url, url]);
    await show('update', 'lints-canon', EXAMPLE, '--quiet');
    expect(await quiet()).toEqual([url, url]);
    Object.assign(Bun.env, { SHOW_NO_BROWSER: '1' });
    await show('update', 'lints-canon', EXAMPLE);
    expect(await quiet()).toEqual([url, url]);
    Reflect.deleteProperty(Bun.env, 'SHOW_NO_BROWSER');
    Object.assign(Bun.env, { SHOW_OPENER: `${root}/missing` });
    expect(await show('update', 'lints-canon', EXAMPLE)).toEqual([0, url]);
  } finally {
    Object.assign(Bun.env, { SHOW_NO_BROWSER: '1' });
    Reflect.deleteProperty(Bun.env, 'SHOW_OPENER');
  }
});

test('state survives a restart, a wait rides through it, and every stop drains once', async () => {
  const { root, stop } = await boot();
  await show('open', EXAMPLE);
  await show('status', 'lints-canon', 'kept');
  const listed = await said('list');
  const [listing] = listed.split('lints-canon', 1);
  await fetch(
    `${listing}__hud/say`,
    json({ page: '/lints-canon', selector: 'h1', text: 'before' }),
  );
  await show('wait', 'lints-canon');
  writeFileSync(`${root}/lints-canon/status.json.tmp`, 'torn');
  const waiting = parsed('wait', 'lints-canon');
  await Bun.sleep(SHORT_MS);
  await Promise.all([stop('first'), stop('second')]);
  const again = await serve({ port: 0 });
  stops.push(() => again.stop('test'));
  expect(existsSync(`${root}/lints-canon/status.json.tmp`)).toBe(false);
  expect(await show('list')).toEqual([0, expect.stringContaining('Lints canon · 6 his turn')]);
  await fetch(`${again.url}lints-canon/answer`, json({ message: 'still here?', question: 'else' }));
  expect(await waiting).toMatchObject(['answer', { [POSITION]: 1, message: 'still here?' }]);
  expect(readFileSync(`${root}/show.log`, 'utf8')).toMatch(/exit first\n.*start /u);
});

test('a stop signal and a panic both drain, and log why', async () => {
  const { root } = await boot();
  process.emit('SIGTERM', 'SIGTERM');
  await Bun.sleep(LONG_MS);
  expect(await show('list')).toEqual([1, expect.stringMatching(/^show: down:/u)]);
  await boot();
  process.emit('uncaughtException', new Error('boom'));
  await Bun.sleep(LONG_MS);
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
  expect(readFileSync(`${root}/show.log`, 'utf8')).toContain('exit SIGTERM');
  expect(readFileSync(`${stateHome()}/show/show.log`, 'utf8')).toMatch(
    /panic Error: boom[^]*exit panic/u,
  );
});

test(
  'serve runs the daemon in place; setup writes the launchd job and loads it',
  async () => {
    Object.assign(Bun.env, {
      SHOW_HUD: `${DIR}/fake-hud.ts`,
      SHOW_PORT: '0',
      XDG_STATE_HOME: mkdtempSync('/tmp/show-'),
    });
    expect(await show('serve')).toEqual([0, '']);
    process.emit('SIGINT', 'SIGINT');
    await Bun.sleep(LONG_MS);
    const home = mkdtempSync('/tmp/show-');
    mkdirSync(`${home}/Library/LaunchAgents`, { recursive: true });
    // a spawned child gets the environment the process started with, so the stub carries its own paths
    // a bootstrap that fails `fails` times (launchd still unloading the old job) and then loads it
    const launchctl = (fails: number): void => {
      writeFileSync(`${home}/tries`, '');
      writeFileSync(
        `${home}/launchctl`,
        `#!/bin/sh\necho "$*" >> ${home}/calls; [ "$1" = bootout ] && exit 0\necho >> ${home}/tries; [ $(wc -l < ${home}/tries) -gt ${fails} ] || { echo 'Bootstrap failed: 5: Input/output error' >&2; exit 5; }\n`,
      );
      chmodSync(`${home}/launchctl`, EXECUTABLE);
    };
    const { HOME, PATH } = Bun.env;
    Object.assign(Bun.env, { HOME: home, PATH: home });
    try {
      // a job that would come up without hud is refused before anything changes
      Object.assign(Bun.env, { SHOW_HUD: '/nope.ts' });
      expect(await show('setup')).toEqual([
        1,
        "show: hud_off: no hud server at /nope.ts: SHOW_HUD=<hud's src/server.ts> show setup",
      ]);
      Object.assign(Bun.env, { SHOW_HUD: `${DIR}/fake-hud.ts` });
      launchctl(2);
      expect(await show('setup')).toEqual([
        0,
        `loaded io.jlg.show from ${home}/Library/LaunchAgents/io.jlg.show.plist`,
      ]);
      // two failures, then the load
      expect(readFileSync(`${home}/tries`, 'utf8')).toHaveLength(['fail', 'fail', 'load'].length);
      launchctl(BOOTSTRAP_TRIES);
      expect(await said('setup')).toEndWith(': Bootstrap failed: 5: Input/output error');
      expect(readFileSync(`${home}/tries`, 'utf8')).toHaveLength(BOOTSTRAP_TRIES);
    } finally {
      Object.assign(Bun.env, { HOME, PATH });
    }
    expect(readFileSync(`${home}/Library/LaunchAgents/io.jlg.show.plist`, 'utf8')).toBe(
      plist('null', `${DIR}/fake-hud.ts`),
    );
    expect(readFileSync(`${home}/calls`, 'utf8')).toMatch(
      /^bootout gui\/\d+\/io\.jlg\.show\nbootstrap gui\/\d+ .*\n/u,
    );
  },
  BOOTSTRAP_MS,
);

test('the launchd job keeps show alive under the repo pinned bun', () => {
  const text = plist('/usr/local/bin/mise');
  // SHOW_HUD rides the job only when setup had it, its key first as the keys are sorted
  expect(text).not.toContain('EnvironmentVariables');
  expect(plist('/usr/local/bin/mise', '/hud.ts')).toContain(
    '<dict>\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>SHOW_HUD</key>\n    <string>/hud.ts</string>\n  </dict>\n  <key>KeepAlive</key>',
  );
  expect(text).toContain('<key>KeepAlive</key>\n  <true/>');
  expect(text).toContain('<key>RunAtLoad</key>\n  <true/>');
  expect(text).toContain('<string>io.jlg.show</string>');
  expect(text).toContain(
    `    <string>/usr/local/bin/mise</string>\n    <string>x</string>\n    <string>-C</string>\n    <string>${DIR}</string>\n    <string>--</string>\n    <string>bun</string>\n    <string>${DIR}/show</string>\n    <string>serve</string>`,
  );
});
