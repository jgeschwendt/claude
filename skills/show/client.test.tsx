// The browser side in a happy-dom window on a real daemon: hydrate the served page, Send through the form action,
// say it on a stand-in <hud> (fake-hud's owner route), follow both sockets, and reload on a new version or a close.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, expect, spyOn, test } from 'bun:test';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { run } from './cli.ts';
import { App, type State } from './page.tsx';
import { serve } from './server.tsx';

const { mkdtempSync } = process.getBuiltinModule('node:fs');

/**
the state the server put in the page, which the client reads from this global
*/
const SHOW_KEY = '__SHOW__';
const MARKER = `window.${SHOW_KEY}=`;
/**
how many times `until` looks before it gives up
*/
const TRIES = 200;
const WAIT_MS = 10;
/**
the field that tells an event its place in the plan's log
*/
const POSITION = 'n';
/**
the checks on a question with a picked pick-one option and two picked pick-many ones
*/
const THREE = 3;

Object.assign(Bun.env, {
  SHOW_HUD: `${import.meta.dir}/fake-hud.ts`,
  SHOW_NO_BROWSER: '1',
  XDG_STATE_HOME: mkdtempSync('/tmp/show-'),
});
Reflect.deleteProperty(Bun.env, 'CLAUDE_CODE_SESSION_ID');
const daemon = await serve({ port: 0 });
const [, url] = await run(['open', `${import.meta.dir}/example.json`]);
const served = await fetch(url);
const html = await served.text();
const native = { Headers, Request, Response, fetch };
GlobalRegistrator.register({ url });
// the daemon and the CLI share this process: they keep Bun's HTTP classes, and a Unix-socket call Bun's fetch
const page = fetch;
Object.assign(globalThis, {
  Headers: native.Headers,
  Request: native.Request,
  Response: native.Response,
  fetch: (input: string, init?: { unix?: string }) =>
    (init?.unix ? native.fetch : page)(input, init),
});

/**
long enough for the scheduler's task queued by the test's last render
*/
const SETTLE_MS = 100;

afterAll(async () => {
  // React's scheduler reads `window` in a task of its own after the last commit: let it run before the window goes
  await Bun.sleep(SETTLE_MS);
  await GlobalRegistrator.unregister();
  await daemon.stop('test');
});

/**
poll until `found` holds: React and the sockets settle on their own schedule
*/
async function until(found: () => unknown, tries = 0): Promise<void> {
  if (found()) {
    return;
  }
  expect(tries).toBeLessThan(TRIES);
  await Bun.sleep(WAIT_MS);
  await until(found, tries + 1);
}
/**
the first match inside `root`, which the test expects to be there
*/
function find<Found extends Element>(root: ParentNode, selector: string): Found {
  const found = root.querySelector<Found>(selector);
  expect(found).not.toBeNull();
  return found as Found;
}
function question(id: string): HTMLElement {
  return find(document, `[id="question-${id}"]`);
}
function labels(id: string): (string | null)[] {
  return [...question(id).querySelectorAll('button')].map((button) => button.textContent);
}
function send(id: string, message: string, choice?: string): void {
  if (choice) {
    find<HTMLInputElement>(question(id), `input[value=${choice}]`).click();
  }
  find<HTMLTextAreaElement>(question(id), 'textarea').value = message;
  find<HTMLButtonElement>(question(id), 'button[value=answer]').click();
}
/**
what a `wait` printed, as its kind and the props of the event it carries
*/
async function waited(): Promise<Record<string, unknown>> {
  const [, text] = await run(['wait', 'lints-canon']);
  const [kind, own] = JSON.parse(text);
  return { kind, ...own };
}
/**
what a `wait` printed without its place in the log
*/
async function waitedBare(): Promise<Record<string, unknown>> {
  const event = await waited();
  Reflect.deleteProperty(event, POSITION);
  return event;
}

test('hydrates, sends, says it on hud and follows both sockets', async () => {
  const reload = spyOn(location, 'reload').mockImplementation(() => {
    // the page does not reload under test: the call is what is counted
  });
  const parser = new DOMParser();
  const fragment = parser.parseFromString(
    html.slice(html.indexOf('<div id="root">'), html.indexOf('<script')),
    'text/html',
  );
  document.body.replaceChildren(...fragment.body.childNodes);
  const stateAt = html.indexOf(MARKER);
  const stateText = html.slice(stateAt + MARKER.length, html.indexOf('</script>', stateAt));
  Reflect.set(globalThis, SHOW_KEY, JSON.parse(stateText));
  await import('./client.tsx');
  await until(() => Object.keys(question('land')).some((key) => key.startsWith('__react')));

  // a second view of the same state subscribes, and unsubscribes when it unmounts
  const other = createRoot(document.createElement('div'));
  flushSync(() => other.render(<App initial={Reflect.get(globalThis, SHOW_KEY) as State} />));
  other.unmount();

  // an option with a shape draws its path inside the tappable row; one without draws none
  expect(find(question('allow'), 'label.option svg.shape path').getAttribute('d')).toBe(
    'M5 50 L50 10 L95 50 L50 90 Z',
  );
  expect(question('allow').querySelectorAll('svg')).toHaveLength(1);

  // a pick-one choice has a ↵ per option, a pick-many one a single ↵ beside them all; a question without choices has
  // only Ask
  expect([labels('land'), labels('allow'), labels('attribute'), labels('else')]).toEqual([
    ['↵', '↵', 'Ask', 'Resolve'],
    ['↵', 'Ask', 'Resolve'],
    ['↵', '↵', '↵', 'Ask', 'Resolve'],
    ['Ask', 'Resolve'],
  ]);

  // a tabbed code context: the first tab shows, a click selects another, the plain one shows its text
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const panel = find(document, '[role=tabpanel]');
  expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  expect(panel.querySelector('.lit')).not.toBeNull();
  tabs[2]?.click();
  await until(() => tabs[2]?.getAttribute('aria-selected') === 'true');
  expect(panel.querySelector('.lit')).toBeFalsy();
  expect(panel.textContent).toBe('plain notes, no highlighting');

  // no <hud> yet: a Send records the answer and says nothing
  send('else', 'no hud here');
  expect(await waited()).toMatchObject({
    message: 'no hud here',
    question: 'else',
  });
  await until(() => question('else').textContent?.includes('send again any time'));

  // the lean is marked, not chosen, and a second tap takes a choice back
  const hold = find<HTMLInputElement>(question('land'), 'input[value=hold]');
  expect(question('land').querySelector('input:checked')).toBeNull();
  hold.click();
  await until(() => hold.checked);
  hold.click();
  await until(() => !hold.checked);

  // his own words alone answer an option question, and the resolved line reads them
  send('land', 'both, staged');
  const alone = await waited();
  expect(alone).toMatchObject({ kind: 'answer', message: 'both, staged', question: 'land' });
  expect(alone).not.toHaveProperty('picks');
  await run(['resolve', 'lints-canon', 'land']);
  await until(
    () =>
      document.querySelector('.resolved summary')?.textContent ===
      '✓ jlg.io harness · both, staged',
  );

  // a <hud> that relays what the page says to fake-hud as the owner, and hands the threads back
  const host = document.createElement('hud');
  document.body.append(host);
  let thread = { id: '' };
  async function relay(route: string, detail: object): Promise<void> {
    const response = await native.fetch(`${url.replace('lints-canon', '')}__hud/${route}`, {
      body: JSON.stringify({ ...detail, page: location.pathname }),
      method: 'POST',
    });
    thread = await response.json();
    host.dispatchEvent(
      new CustomEvent('hud:threads', { bubbles: true, detail: { threads: [thread] } }),
    );
  }
  for (const name of ['hud:open', 'hud:reply']) {
    host.addEventListener(name, (event) => relay('say', (event as CustomEvent<object>).detail));
  }
  send('land', 'look first', 'hold');
  expect(await waited()).toMatchObject({
    message: 'look first',
    picks: { land: ['hold'] },
    question: 'land',
  });
  await until(() =>
    question('land')
      .querySelector('.thread')
      ?.textContent?.includes('land: hold, I want to look — look first'),
  );
  send('land', 'still there?');
  expect(await waited()).toMatchObject({ message: 'still there?' });
  await until(() => question('land').querySelectorAll(':scope .thread li').length === 2);
  expect(find<HTMLInputElement>(question('land'), 'input[value=hold]').checked).toBe(true);

  // the question he last spoke on waits below the untouched ones; the agent's reply lifts it to the top
  expect(document.querySelector('.waiting article')?.id).toBe('question-land');
  await relay('reply', { id: thread.id, text: 'on it' });
  await until(() => document.querySelector('main > article')?.id === 'question-land');
  expect(document.querySelector('.waiting')).toBeNull();

  // a pick-many question: picks toggle on and off, and its one ↵ sends them all
  for (const value of ['ascii', 'docs', 'numeric', 'docs']) {
    find<HTMLInputElement>(question('allow'), `input[value=${value}]`).click();
  }
  await until(() => question('allow').querySelectorAll('input:checked').length === 2);
  find<HTMLButtonElement>(question('allow'), '[aria-label="Send Allowed rules"]').click();
  const many = await waited();
  expect(many).toMatchObject({ picks: { rules: ['numeric', 'ascii'] } });
  expect(many).not.toHaveProperty('notes');
  await until(() =>
    question('allow')
      .querySelector('.thread')
      ?.textContent?.includes('Allowed rules: default_numeric_fallback, non_ascii_literal'),
  );

  // a question with two choices: a pick-one's ↵ sends just that option and its comment, a pick-many's tall ↵ just that
  // choice's picks, Ask every choice's picks with the message
  find<HTMLInputElement>(question('attribute'), 'input[value=drop]').click();
  find<HTMLInputElement>(question('attribute'), '[name="note:keep:drop"]').value = 'why keep it';
  find<HTMLButtonElement>(question('attribute'), 'button[name=only][value="keep:drop"]').click();
  expect(await waitedBare()).toEqual({
    at: expect.any(String),
    kind: 'answer',
    notes: { keep: { drop: 'why keep it' } },
    picks: { keep: ['drop'] },
    question: 'attribute',
  });
  // a Send's buttons are disabled until hud has carried what it said, and the form is reset once it has
  await until(() => !question('attribute').querySelector('button:disabled'));
  for (const value of ['tests', 'canon']) {
    find<HTMLInputElement>(question('attribute'), `input[value=${value}]`).click();
  }
  await until(() => question('attribute').querySelectorAll('input:checked').length === THREE);
  find<HTMLButtonElement>(question('attribute'), '[aria-label="Send Where it applies"]').click();
  expect(await waitedBare()).toEqual({
    at: expect.any(String),
    kind: 'answer',
    picks: { where: ['canon', 'tests'] },
    question: 'attribute',
  });
  // happy-dom's form reset after a Send drops the checks until the choice renders again: one more pick does
  await until(() => !question('attribute').querySelector('button:disabled'));
  find<HTMLInputElement>(question('attribute'), 'input[value=routines]').click();
  send('attribute', 'all of it');
  expect(await waited()).toMatchObject({
    message: 'all of it',
    picks: { keep: ['drop'], where: ['routines', 'canon', 'tests'] },
  });

  // a pick-one ✎ opens its comment inline; Enter in it, or its ↵, sends just that option
  find<HTMLInputElement>(question('land'), '[name="note:land:hold"]').focus();
  await until(() => question('land').querySelector(':scope .pick.open [name="note:land:hold"]'));
  const note = find<HTMLInputElement>(question('land'), '[name="note:land:hold"]');
  note.value = 'only this';
  note.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  note.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
  );
  expect(await waited()).toMatchObject({
    kind: 'answer',
    notes: { land: { hold: 'only this' } },
    picks: { land: ['hold'] },
  });
  find<HTMLInputElement>(question('land'), '[name="note:land:land"]').value = 'later';
  find<HTMLButtonElement>(question('land'), 'button[name=only][value="land:land"]').click();
  expect(await waited()).toMatchObject({
    notes: { land: { land: 'later' } },
    picks: { land: ['land'] },
  });

  // the daemon refuses: the question says why
  send('else', ' ');
  await until(
    () =>
      question('else').querySelector('[role=alert]')?.textContent === 'not sent: write a message',
  );

  // the agent's status arrives over show's socket, no reload
  await run(['status', 'lints-canon', 'decided: hold']);
  await until(() => document.querySelector('.tasks li')?.textContent === 'decided: hold');

  // he resolves a question himself: `show wait` hears it, and the question collapses to its line
  find<HTMLButtonElement>(question('else'), 'button[value=resolve]').click();
  expect(await waited()).toMatchObject({ kind: 'resolve', question: 'else' });
  await until(() => document.querySelector('.resolved')?.textContent?.includes('✓ Anything else?'));
  // every question is a task: checked once resolved, a link to it either way
  expect(
    ['else', 'land'].map((id) => find(document, `.tasks a[href="#question-${id}"]`).textContent),
  ).toEqual(['☑ Anything else?', '☐ jlg.io harness']);

  // a close reloads the page (as a new daemon version does)
  expect(reload).not.toHaveBeenCalled();
  await run(['close', 'lints-canon']);
  await until(() => reload.mock.calls.length > 0);

  // with the daemon gone, a Send says show is down
  await daemon.stop('test');
  send('land', 'anyone?');
  await until(
    () => question('land').querySelector('[role=alert]')?.textContent === 'not sent: show is down',
  );
});
