// A stand-in for `@jlg/hud/server` in the tests, where no hud checkout exists (CI): the same `hud({ fetch, onChange,
// store, WebSocket })` shape and agent routes, threads in `store`, and `POST /__hud/say` for the owner's own comment.
type Thread = {
  id: string;
  messages: { at: string; author: 'agent' | 'user'; text: string }[];
  page: string;
  selector: string;
  status: 'open' | 'resolved';
};

const { existsSync, readFileSync, writeFileSync } = process.getBuiltinModule('node:fs');

/**
the fraction of a second a timestamp carries: milliseconds, as `toISOString` does
*/
const MS_DIGITS = 3;

const hud = ({
  fetch,
  onChange,
  store,
  websocket,
}: {
  fetch: (request: Request, server: unknown) => unknown;
  onChange: (threads: Thread[]) => void;
  store: string;
  websocket: unknown;
}): object => {
  type Said = { id?: string; page: string; selector: string; text: string };
  const threads: Thread[] = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : [];
  // the thread with this id, or a new one for the page and selector the owner spoke on
  const thread = ({ id, page, selector }: Said): Thread => {
    const found = threads.find((one) => one.id === id);
    const made: Thread = { id: crypto.randomUUID(), messages: [], page, selector, status: 'open' };
    if (!found) {
      threads.push(made);
    }
    return found ?? made;
  };
  const say = (one: Thread, author: 'agent' | 'user', text: string): Thread => {
    one.messages.push({
      at: Temporal.Now.instant().toString({ fractionalSecondDigits: MS_DIGITS }),
      author,
      text,
    });
    one.status = 'open';
    return one;
  };
  const routes: Record<string, (body: Said) => Thread> = {
    '/__hud/reply': (body) => say(thread(body), 'agent', body.text),
    '/__hud/resolve': (body) => Object.assign(thread(body), { status: 'resolved' }),
    '/__hud/say': (body) => say(thread(body), 'user', body.text),
  };
  return {
    fetch: async (request: Request, server: unknown) => {
      const { pathname } = new URL(request.url);
      const route = routes[pathname];
      if (!route) {
        return fetch(request, server);
      }
      const reply = route(await request.json());
      writeFileSync(store, JSON.stringify(threads));
      onChange(structuredClone(threads));
      return Response.json(reply);
    },
    threads: () => structuredClone(threads),
    websocket,
  };
};

export { hud };
