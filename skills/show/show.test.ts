// End to end in this process, so the coverage counts: real daemons on port 0 under scratch state, driven through
// the CLI's `run`, the page's HTTP and WebSocket surface, and fake-hud.ts standing in for hud.
import { afterEach, expect, test } from 'bun:test';
import { validate } from './catalog.tsx';
import { FIX, VERSION, plist, run } from './cli.ts';
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
const FORM = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
/**
the characters of an id the CLI prints
*/
const ID_SHORT = 8;
/**
the daemon's log rotates past this size
*/
/**
how many times a browser call is looked for before it is called missing
*/
const LANDED_TRIES = 100;
const LOG_CAP = 1_048_576;
/**
a pause long enough for a stop or a signal to drain
*/
const LONG_MS = 100;
const NOT_FOUND = 404;
const OK = 200;
/**
the field that tells an event its place in the form's log
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
const parsed = async (...argv: string[]): Promise<Record<string, unknown>> =>
  JSON.parse(await said(...argv));
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

test('validate names the card and the field of every problem', () => {
  expect(validate(FORM)).toEqual([]);
  expect(validate([])).toEqual(['form: expected {title, cards: [card, …], overview?, text?}']);
  expect(
    validate({
      cards: [
        'seven',
        { component: 'gauge', id: 'g' },
        {
          component: 'decision',
          extra: 1,
          id: 'a',
          options: [{ label: 'x', value: 'x' }],
          text: 'y',
          title: 't',
        },
        { component: 'note', id: 'a', text: '', title: 't' },
        {
          component: 'decision',
          id: 'm',
          options: [{ hint: 'h', label: 'x', value: 'x' }],
          pick: 'many',
          text: 'y',
          title: 't',
        },
        { component: 'note', id: 'p', pick: 'some', text: 't', title: 't' },
        {
          component: 'decision',
          id: 'sh',
          options: [{ label: 'x', lean: true, shape: '', value: 'x' }],
          text: 'y',
          title: 't',
        },
        { component: 'chart', id: '1', kind: 'pie', rows: [{ label: 'l', value: -1 }], title: 't' },
        {
          component: 'teach',
          cost: 'c',
          id: 'b',
          options: [{ label: 'x', lean: true, value: 'x' }],
          pair: ['a'],
          text: 't',
          title: 't',
        },
        { code: 'x', component: 'code', id: 'c', lang: 'nope', title: 't' },
      ],
      overview: [
        { component: 'decision', title: 't' },
        { component: 'steps', id: 'x', items: ['a'], loop: false, title: 't' },
        { component: 'figure', svg: '<svg/>', title: 't' },
        { component: 'figure', title: 't' },
      ],
      title: 'f',
      wat: true,
    }),
  ).toEqual([
    'form.wat: not a field (cards, overview?, text?, title)',
    'overview[0].component: unknown "decision", the catalog has chart, code, figure, list, note, steps',
    'overview[1] steps.loop: expected true, got false',
    'overview[1] steps.id: not a field (title, items, loop?, text?)',
    'overview[3] figure.svg: expected a non-empty string, got nothing',
    'cards[0]: expected an object',
    'cards[1] g.component: unknown "gauge", the catalog has chart, code, figure, list, note, steps, decision, teach',
    'cards[2] a decision.options: expected [{label, value, lean?: true, hint?, shape?}, …], values distinct, exactly one lean unless pick is "many", got [{"label":"x","value":"x"}]',
    'cards[2] a decision.extra: not a field (id, meta?, pick?, title, options, text)',
    'cards[3] a.id: duplicate',
    'cards[3] a note.text: expected a non-empty string, got ""',
    'cards[5] p note.pick: expected "one" or "many", got "some"',
    'cards[6] sh decision.options: expected [{label, value, lean?: true, hint?, shape?}, …], values distinct, exactly one lean unless pick is "many", got [{"label":"x","lean":true,"shape":"","value":"x"}]',
    'cards[7] 1 chart.id: expected a letter, then letters, digits, - or _, got "1"',
    'cards[7] 1 chart.kind: expected "bar" or "split", got "pie"',
    'cards[7] 1 chart.rows: expected [{label, value: a number ≥ 0}, …], got [{"label":"l","value":-1}]',
    'cards[8] b teach.pair: expected [today, alternative], two strings, got ["a"]',
    'cards[9] c code.lang: expected a shiki language id, such as "rust" or "sh", got "nope"',
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
  const { state: booted } = await parsed('health');
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
  expect(await jsonOf(control('/forms', 'old'))).toEqual({
    error: { code: 'version', message: `daemon runs ${VERSION}, this CLI is old: ${FIX}` },
  });
  expect(await statusOf(control('/nope'))).toBe(NOT_FOUND);
  expect(await show('list')).toEqual([0, 'no open forms']);
});

test('without hud it runs degraded, and replies say why', async () => {
  const { url } = await boot(`${DIR}/missing.ts`);
  const { reason, state } = await parsed('health');
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
    'show: exists: lints-canon is open: show update lints-canon <form.json>, or open with --slug',
  ]);
  const bad = `${stateHome()}/bad.json`;
  writeFileSync(bad, JSON.stringify({ cards: [], title: 't' }));
  expect(await show('open', bad, '--slug', 'Bad Slug')).toEqual([
    1,
    'show: invalid: form.cards: expected [card, …], got []\nslug "Bad Slug": lowercase letters, digits and -',
  ]);
  expect(await show('list')).toEqual([
    0,
    `${url}  Lints canon · 6 his turn · 0 waiting on the agent · 0 agent working · `,
  ]);
  const page = await textOf(fetch(url));
  expect(page).toContain('allow in canon<!-- --> ★');
  expect(page).toContain(`<div class="figure"><svg viewBox='0 0 400 80'`);
  expect(page).toContain('window.__SHOW__={');
  // highlighted on the server, in the state the page hydrates from, uncoloured by anything but variables
  expect(page).toContain('<div class="lit"><pre class="shiki css-variables"');
  expect(page).toContain('color:var(--shiki-token-keyword)');
  expect(page).toContain(String.raw`"html":["<pre class=\"shiki css-variables\"`);
  const index = await fetch(url.replace('lints-canon', ''));
  expect(await index.text()).toContain('Lints canon');
  const missing = await fetch(url.replace('lints-canon', 'gone'));
  expect([missing.status, await missing.text()]).toEqual([
    NOT_FOUND,
    expect.stringContaining('No open form at /gone'),
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
  expect(await statusOf(answer({ card: 'nope' }))).toBe(NOT_FOUND);
  expect(
    await statusOf(
      fetch(`${url}/answer`, { body: 'not json', headers: { origin }, method: 'POST' }),
    ),
  ).toBe(NOT_FOUND);
  const wrong = {
    error: { code: 'invalid', message: 'choose one of land, hold, or write a message' },
  };
  expect(
    await Promise.all(
      [{ choice: 'maybe' }, { message: ' ' }, { choices: ['land', 'hold'] }].map((body) =>
        jsonOf(answer({ card: 'land', ...body })),
      ),
    ),
  ).toEqual([wrong, wrong, wrong]);
  expect(await jsonOf(answer({ card: 'else', message: ' ' }))).toEqual({
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
  expect(await statusOf(answer({ card: 'land', choice: 'hold', message: ' look first ' }))).toBe(
    OK,
  );
  expect(await parsed('wait', 'lints-canon')).toEqual({
    [POSITION]: 0,
    at: expect.any(String),
    card: 'land',
    choice: 'hold',
    kind: 'answer',
    message: 'look first',
  });
  const next = parsed('wait', 'lints-canon');
  await Bun.sleep(SHORT_MS);
  await answer({ card: 'else', message: 'ship it' });
  expect(await next).toMatchObject({
    [POSITION]: 1,
    card: 'else',
    kind: 'answer',
    message: 'ship it',
  });
  // his own words alone answer an option card: no choice key
  await answer({ card: 'land', message: 'both, staged' });
  expect(await parsed('wait', 'lints-canon')).toEqual({
    [POSITION]: 2,
    at: expect.any(String),
    card: 'land',
    kind: 'answer',
    message: 'both, staged',
  });
  // a pick-many card: choices in authored order, and only the option comments he wrote
  await answer({
    card: 'allow',
    choices: ['ascii', 'numeric'],
    notes: { ascii: ' ', docs: ' later ', zzz: 'x' },
  });
  expect(await parsed('wait', 'lints-canon')).toMatchObject({
    choices: ['numeric', 'ascii'],
    notes: { docs: 'later' },
  });
  socket.send('the page never speaks on its socket');
  await Bun.sleep(SHORT_MS);
  expect(frames.at(-1)?.events?.at(-1)).toMatchObject({ notes: { docs: 'later' } });
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
  await fetch(`${url}/answer`, json({ card: 'land', choice: 'land' }));
  const thread = await say({ page: '/lints-canon', selector: '#card-land', text: 'land as it is' });
  const pinned = await say({ page: '/lints-canon', selector: 'h1', text: 'nice title' });
  await say({ page: '/elsewhere', selector: 'h1', text: 'not a form' });
  expect(await parsed('wait', 'lints-canon')).toMatchObject({
    [POSITION]: 0,
    choice: 'land',
  });
  expect(await parsed('wait', 'lints-canon')).toMatchObject({
    [POSITION]: 1,
    kind: 'comment',
    text: 'nice title',
    thread: pinned.id,
  });
  // counts are cards: a comment on the title is no card's
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
  await say({ id: thread.id, page: '/lints-canon', selector: '#card-land', text: 'and then?' });
  expect(await parsed('wait', 'lints-canon')).toMatchObject({
    card: 'land',
    kind: 'comment',
    text: 'and then?',
  });
  // his word on a working card makes it wait on the agent; a plain reply hands it back to him
  expect(await said('list')).toContain('· 5 his turn · 1 waiting on the agent · 0 agent working ·');
  await said('reply', 'lints-canon', 'land', 'landed: your call');
  expect(await said('list')).toContain('· 6 his turn · 0 waiting on the agent · 0 agent working ·');
  expect(await show('resolve', 'lints-canon', 'land')).toEqual([0, 'resolved land']);
  expect(await show('resolve', 'lints-canon', pinned.id)).toEqual([0, `resolved ${pinned.id}`]);
  expect(await show('resolve', 'lints-canon', thread.id)).toEqual([0, 'resolved land']);
  expect(await show('resolve', 'lints-canon', 'zzz')).toEqual([
    1,
    'show: not_found: no card or thread zzz on lints-canon',
  ]);
  const stray = fetch(`${url}/resolve`, json({ card: 'zzz' }));
  expect(await textOf(stray)).toContain('no card zzz on lints-canon');
  const page = await textOf(fetch(url));
  expect(page).toContain('<a class="back" href="/">← All forms</a>');
  expect(page).toContain('Resolved · 1');
  expect(page).toContain('✓ jlg.io harness<!-- --> · land as it is');
  expect(await said('list')).toContain('· 5 his turn · 0 waiting');
  await fetch(`${url}/answer`, json({ card: 'land', choice: 'hold' }));
  expect(await said('list')).toContain('· 6 his turn · 0 waiting');
});

test('update, status, close and the routes that refuse', async () => {
  const url = await opened();
  const changed = `${stateHome()}/changed.json`;
  writeFileSync(changed, JSON.stringify({ ...FORM, title: 'Lints canon, again' }));
  expect(await show('update', 'lints-canon', changed)).toEqual([0, url]);
  writeFileSync(changed, '{}');
  expect(await said('update', 'lints-canon', changed)).toStartWith(
    'show: invalid: form.cards: expected',
  );
  expect(await show('update', 'nope', EXAMPLE)).toEqual([1, 'show: not_found: no open form nope']);
  const socket = `${stateHome()}/show/show.sock`;
  const refusal = await jsonOf(
    fetch('http://show/forms/lints-canon/status', {
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
  expect(await show('list')).toEqual([0, 'no open forms']);
  expect(await show('open', EXAMPLE)).toEqual([0, url]);
});

test('open and update show the form in the browser, unless told not to', async () => {
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
  await fetch(`${again.url}lints-canon/answer`, json({ card: 'else', message: 'still here?' }));
  expect(await waiting).toMatchObject({ [POSITION]: 1, message: 'still here?' });
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
