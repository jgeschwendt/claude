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
function card(id: string): HTMLElement {
  return find(document, `[id="card-${id}"]`);
}
function labels(id: string): (string | null)[] {
  return [...card(id).querySelectorAll('button')].map((button) => button.textContent);
}
function send(id: string, message: string, choice?: string): void {
  if (choice) {
    find<HTMLInputElement>(card(id), `input[value=${choice}]`).click();
  }
  find<HTMLTextAreaElement>(card(id), 'textarea').value = message;
  find<HTMLButtonElement>(card(id), 'button[value=answer]').click();
}
/**
what a `wait` printed, as the event it carries
*/
async function waited(): Promise<Record<string, unknown>> {
  const [, text] = await run(['wait', 'lints-canon']);
  return JSON.parse(text);
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
  await until(() => Object.keys(card('land')).some((key) => key.startsWith('__react')));

  // a second view of the same state subscribes, and unsubscribes when it unmounts
  const other = createRoot(document.createElement('div'));
  flushSync(() => other.render(<App initial={Reflect.get(globalThis, SHOW_KEY) as State} />));
  other.unmount();

  // an option with a shape draws its path inside the tappable row; one without draws none
  expect(find(card('allow'), 'label.option svg.shape path').getAttribute('d')).toBe(
    'M5 50 L50 10 L95 50 L50 90 Z',
  );
  expect(card('allow').querySelectorAll('svg')).toHaveLength(1);

  // a pick-one card has a ↵ per option and no Send, a pick-many one a Send and no ↵; a card without options has only Ask
  expect([labels('land'), labels('allow'), labels('else')]).toEqual([
    ['↵', '↵', 'Ask', 'Resolve'],
    ['Send', 'Ask', 'Resolve'],
    ['Ask', 'Resolve'],
  ]);

  // no <hud> yet: a Send records the answer and says nothing
  send('else', 'no hud here');
  expect(await waited()).toMatchObject({
    card: 'else',
    message: 'no hud here',
  });
  await until(() => card('else').textContent?.includes('send again any time'));

  // the lean is marked, not chosen, and a second tap takes a choice back
  const hold = find<HTMLInputElement>(card('land'), 'input[value=hold]');
  expect(card('land').querySelector('input:checked')).toBeNull();
  hold.click();
  await until(() => hold.checked);
  hold.click();
  await until(() => !hold.checked);

  // his own words alone answer an option card, and the resolved line reads them
  send('land', 'both, staged');
  const alone = await waited();
  expect(alone).toMatchObject({ card: 'land', kind: 'answer', message: 'both, staged' });
  expect(alone).not.toHaveProperty('choice');
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
    card: 'land',
    choice: 'hold',
    message: 'look first',
  });
  await until(() =>
    card('land')
      .querySelector('.thread')
      ?.textContent?.includes('hold, I want to look — look first'),
  );
  send('land', 'still there?');
  expect(await waited()).toMatchObject({ message: 'still there?' });
  await until(() => card('land').querySelectorAll(':scope .thread li').length === 2);
  expect(find<HTMLInputElement>(card('land'), 'input[value=hold]').checked).toBe(true);

  // the card he last spoke on waits below the untouched ones; the agent's reply lifts it to the top
  expect(document.querySelector('.waiting article')?.id).toBe('card-land');
  await relay('reply', { id: thread.id, text: 'on it' });
  await until(() => document.querySelector('main > article')?.id === 'card-land');
  expect(document.querySelector('.waiting')).toBeNull();

  // a pick-many card: picks toggle on and off, and an option's own comment rides the Send and the thread
  for (const value of ['ascii', 'docs', 'numeric', 'docs']) {
    find<HTMLInputElement>(card('allow'), `input[value=${value}]`).click();
  }
  await until(() => card('allow').querySelectorAll('input:checked').length === 2);
  find<HTMLInputElement>(card('allow'), '[name=note-docs]').value = 'later';
  find<HTMLButtonElement>(card('allow'), 'button[value=answer]').click();
  expect(await waited()).toMatchObject({ choices: ['numeric', 'ascii'], notes: { docs: 'later' } });
  await until(() =>
    card('allow')
      .querySelector('.thread')
      ?.textContent?.includes(
        'default_numeric_fallback — non_ascii_literal — missing_docs_in_private_items: later',
      ),
  );

  // a pick-many ✎ only comments: Enter there is left to the form
  const many = find<HTMLInputElement>(card('allow'), '[name=note-ascii]');
  many.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
  );

  // a pick-one ✎ opens its comment inline; Enter in it, or its ↵, sends just that option
  find<HTMLInputElement>(card('land'), '[name=note-hold]').focus();
  await until(() => card('land').querySelector(':scope .pick.open [name=note-hold]'));
  const note = find<HTMLInputElement>(card('land'), '[name=note-hold]');
  note.value = 'only this';
  note.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  note.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
  );
  expect(await waited()).toMatchObject({
    choice: 'hold',
    kind: 'answer',
    notes: { hold: 'only this' },
  });
  find<HTMLInputElement>(card('land'), '[name=note-land]').value = 'later';
  find<HTMLButtonElement>(card('land'), 'button[name=only][value=land]').click();
  expect(await waited()).toMatchObject({ choice: 'land', notes: { land: 'later' } });

  // the daemon refuses: the card says why
  send('else', ' ');
  await until(
    () => card('else').querySelector('[role=alert]')?.textContent === 'not sent: write a message',
  );

  // the agent's status arrives over show's socket, no reload
  await run(['status', 'lints-canon', 'decided: hold']);
  await until(() => document.querySelector('.card ul li')?.textContent === 'decided: hold');

  // he resolves a card himself: `show wait` hears it, and the card collapses to its line
  find<HTMLButtonElement>(card('else'), 'button[value=resolve]').click();
  expect(await waited()).toMatchObject({ card: 'else', kind: 'resolve' });
  await until(() => document.querySelector('.resolved')?.textContent?.includes('✓ Anything else?'));

  // a close reloads the page (as a new daemon version does)
  expect(reload).not.toHaveBeenCalled();
  await run(['close', 'lints-canon']);
  await until(() => reload.mock.calls.length > 0);

  // with the daemon gone, a Send says show is down
  await daemon.stop('test');
  send('land', 'anyone?');
  await until(
    () => card('land').querySelector('[role=alert]')?.textContent === 'not sent: show is down',
  );
});
