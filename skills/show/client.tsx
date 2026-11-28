// The browser's entry: hydrate the server's render, then follow two WebSockets, show's (whole states) and hud's
// (threads, through its `hud:threads` event). Never an EventSource or a streamed fetch: Chromium allows six
// streams per host:port across every tab, and a seventh plan would hang.
import { hydrateRoot } from 'react-dom/client';
import { parse } from 'verax';
import { App, isThreads, publish, stateShape } from './page.tsx';

/**
a dropped socket retries after this long
*/
const RETRY_MS = 1000;
const initial = parse(Reflect.get(globalThis, '__SHOW__'), stateShape);

function connect(): void {
  const socket = new WebSocket(location.href.replace(/^http/u, 'ws'));
  socket.addEventListener('message', ({ data }) => {
    const next = parse(JSON.parse(String(data)), stateShape);
    if (next.closed === true || next.version !== initial.version) {
      location.reload();
    }
    publish(next);
  });
  socket.addEventListener('close', () => {
    setTimeout(connect, RETRY_MS);
  });
}

document.addEventListener('hud:threads', (event) => {
  if (isThreads(event)) {
    publish({ threads: event.detail.threads });
  }
});
publish(initial);
hydrateRoot(document.querySelector('#root') ?? document.body, <App initial={initial} />);
connect();
