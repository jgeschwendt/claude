// A stand-in for `@jlg/hud/server` in the tests, where no hud checkout exists (CI): the same `hud({ fetch, onChange,
// store, WebSocket })` shape and agent routes, threads in `store`, and `POST /__hud/say` for the owner's own comment.
import { type Infer, list, optional, parse, string } from 'verax';
import { loose } from '#loose';
import { threadShape } from './shapes.ts';

type Thread = Infer<typeof threadShape>;

const { existsSync, readFileSync, writeFileSync } = process.getBuiltinModule('node:fs');

/**
the owner's words, and the threads this file stored
*/
const saidShape = loose('said', {
  id: optional(string()),
  page: optional(string()),
  selector: optional(string()),
  text: optional(string()),
});
const threadsShape = list(threadShape);

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
  const threads: Thread[] = existsSync(store)
    ? parse(JSON.parse(readFileSync(store, 'utf8')), threadsShape)
    : [];
  type Said = Infer<typeof saidShape>;
  // the thread with this id, or a new one for the page and selector the owner spoke on
  const thread = ({ id, page = '', selector = '' }: Said): Thread => {
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
    '/__hud/reply': (body) => say(thread(body), 'agent', body.text ?? ''),
    '/__hud/resolve': (body) => Object.assign(thread(body), { status: 'resolved' }),
    '/__hud/say': (body) => say(thread(body), 'user', body.text ?? ''),
  };
  return {
    fetch: async (request: Request, server: unknown) => {
      const { pathname } = new URL(request.url);
      const route = routes[pathname];
      if (!route) {
        return fetch(request, server);
      }
      const reply = route(parse(await request.json(), saidShape));
      writeFileSync(store, JSON.stringify(threads));
      onChange(structuredClone(threads));
      return Response.json(reply);
    },
    threads: () => structuredClone(threads),
    websocket,
  };
};

export { hud };
