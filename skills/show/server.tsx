// The daemon: the browser's pages on loopback TCP (Host and Origin checked, hud mounted in the same server), the
// CLI's control API on a Unix socket in a 0700 directory, every form on disk under `home()/<slug>/`, which a cold
// boot re-reads. One instance by flock; every stop signal drains inside BUDGET_MS, under launchd's 20 s.
import { FFIType, dlopen } from 'bun:ffi';
import { renderToReadableStream } from 'react-dom/server';
import { type Card, type Form, picked, spoken, validate } from './catalog.tsx';
import { DIR, FIX, FailError, VERSION, home, hudPath } from './cli.ts';
import { lit } from './lit.ts';
import {
  App,
  type Entry,
  type State,
  type Status,
  type Summary,
  type Thread,
  selectorOf,
  threadOf,
  turnOf,
} from './page.tsx';

const {
  appendFileSync,
  chmodSync,
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} = process.getBuiltinModule('node:fs');

/**
the status of a request that could not be understood
*/
const BAD_REQUEST = 400;
/**
how long a stop lets in-flight requests finish before it closes every socket
*/
const BUDGET_MS = 5000;
/**
the status of a request the form's current state refuses
*/
const CONFLICT = 409;
/**
the port a browser reaches the pages on when SHOW_PORT does not say
*/
const DEFAULT_PORT = 7469;
/**
the mode of the state directory: the owner alone
*/
const DIR_MODE = 0o700;
/**
how often a stop looks again for in-flight requests
*/
const DRAIN_POLL_MS = 10;
/**
the status of a request from a Host or Origin that is not ours
*/
const FORBIDDEN = 403;
const FORM_FILES = new Bun.Glob('*/form.json');
/**
LOCK_EX (2) | LOCK_NB (4): an exclusive lock that fails rather than waits
*/
const LOCK_EX_NB = 6;
/**
the log rotates past 1 MiB
*/
const LOG_CAP = 1_048_576;
/**
the fraction of a second a timestamp carries: milliseconds, as `toISOString` does
*/
const MS_DIGITS = 3;
const NO_STORE = { 'cache-control': 'no-store' };
/**
the status of a card, form or route that is not there
*/
const NOT_FOUND = 404;
const OK = 200;
const PANICS = ['uncaughtException', 'unhandledRejection'] as const;
/**
a pathname split to its empty lead, its slug and its verb
*/
const PATH_PARTS = 3;
/**
the field that tells an event its place in the form's log
*/
const POSITION = 'n';
const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;
const SLUG = /^[a-z0-9][a-z0-9-]*$/u;
const TEMP_FILES = new Bun.Glob('*/*.tmp');
/**
the status of a daemon that is booting, stopping or has no threads
*/
const UNAVAILABLE = 503;
/**
the status of a form that fails validation
*/
const UNPROCESSABLE = 422;
const { flock } = dlopen(process.platform === 'darwin' ? 'libc.dylib' : 'libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
}).symbols;

function fail(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}
function must(isOk: boolean, code: string, message: string): void {
  if (!isOk) {
    throw new FailError(code, message);
  }
}
function save(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, undefined, 1));
  renameSync(`${path}.tmp`, path);
}
function now(): string {
  return Temporal.Now.instant().toString({ fractionalSecondDigits: MS_DIGITS });
}

/**
boot the daemon; resolves once it serves, with the handle a test (or the CLI's `serve`) holds
*/
async function serve({ port }: { port?: number } = {}): Promise<{
  stop: (reason: string) => Promise<void>;
  url: string;
}> {
  /**
  what `@jlg/hud/server`'s `hud({ fetch, onChange, store, websocket })` returns, as show uses it
  */
  type Layer = {
    fetch: (
      request: Request,
      server: Bun.Server<string> | undefined,
    ) => Promise<Response | undefined> | Response | undefined;
    threads: () => Thread[];
    websocket: Bun.WebSocketHandler<string>;
  };
  type Held = { events: Entry[]; form: Form; status: Status };
  type Body = {
    card?: unknown;
    choice?: unknown;
    choices?: unknown;
    form: Form;
    lines?: unknown;
    message?: unknown;
    notes?: unknown;
    session?: string;
    slug?: string;
    target?: unknown;
    text?: unknown;
    working?: boolean;
  };
  type Said = { choices: string[]; message: string; notes: Record<string, string> };
  type Call = { body: Body; held: Held; slug: string; url: URL };
  type Handler = (call: Call) => Promise<Response> | Response;

  const { SHOW_PORT } = Bun.env;
  const root = home();
  mkdirSync(root, { mode: DIR_MODE, recursive: true });
  chmodSync(root, DIR_MODE);
  must(statSync(root).uid === process.getuid?.(), 'unsafe', `${root} belongs to another user`);
  const lock = openSync(`${root}/show.lock`, 'a+');
  must(
    flock(lock, LOCK_EX_NB) === 0,
    'running',
    `another show holds ${root}/show.lock (pid ${readFileSync(`${root}/show.lock`, 'utf8')})`,
  );
  ftruncateSync(lock);
  writeSync(lock, String(process.pid));
  const logFile = `${root}/show.log`;
  function log(line: string): void {
    if (Bun.file(logFile).size > LOG_CAP) {
      renameSync(logFile, `${logFile}.1`);
    }
    appendFileSync(logFile, `${now()} ${line}\n`);
  }
  log(`start ${VERSION} pid ${process.pid}`);

  const forms = new Map<string, Held>();
  const waiters = new Set<() => void>();
  const live: {
    build?: Bun.BuildOutput;
    layer?: Layer;
    reason: string;
    stage: string;
    tcp?: Bun.Server<string>;
    url: string;
  } = { reason: '', stage: 'booting', url: '' };
  /**
  what the page says on hud for each Send, so `onChange` does not report it a second time
  */
  const expected = new Set<string>();
  const counts = new Map<string, number>();
  /**
  stands for a form that is not open, so a handler that needs one always holds a `Held`
  */
  const none: Held = {
    events: [],
    form: { cards: [], title: '' },
    status: { lines: [], opened: '', resolved: [], session: '', working: [] },
  };
  const building = Bun.build({
    define: { 'process.env.NODE_ENV': '"production"' },
    entrypoints: [`${DIR}/client.tsx`],
    minify: true,
    target: 'browser',
  });

  function wake(): void {
    const ready = [...waiters];
    waiters.clear();
    for (const waiter of ready) {
      waiter();
    }
  }
  function threadsOf(slug: string): Thread[] {
    return live.layer?.threads().filter((thread) => thread.page === `/${slug}`) ?? [];
  }
  function summaries(): Summary[] {
    return [...forms].map(([slug, { form, status }]) => {
      // each card's turn, as the page sorts it
      const turns = form.cards.map((card) =>
        turnOf(card, status, threadOf(slug, card, threadsOf(slug))),
      );
      return {
        session: status.session,
        slug,
        title: form.title,
        url: `${live.url}${slug}`,
        waiting: turns.filter((turn) => turn === 'waiting').length,
        working: turns.filter((turn) => turn === 'working').length,
        yours: turns.filter((turn) => turn === 'yours').length,
      };
    });
  }

  function stateOf(path: string): State {
    const slug = path.slice(1);
    const held = forms.get(slug);
    return held
      ? { ...held, slug, version: VERSION }
      : { forms: summaries(), ...(slug && { missing: slug }), version: VERSION };
  }
  function withThreads(path: string): State {
    return { ...stateOf(path), threads: threadsOf(path.slice(1)) };
  }
  function publish(slug: string): void {
    live.tcp?.publish(`/${slug}`, JSON.stringify(stateOf(`/${slug}`)));
    live.tcp?.publish('/', JSON.stringify(stateOf('/')));
    wake();
  }
  async function hudCall(path: string, body: object): Promise<unknown> {
    const response = await live.layer?.fetch(
      new Request(`http://127.0.0.1/__hud/${path}`, { body: JSON.stringify(body), method: 'POST' }),
      live.tcp,
    );
    return response?.json();
  }
  function cardOf(held: Held, thread?: Thread): Card | undefined {
    return held.form.cards.find((card) => selectorOf(card) === thread?.selector);
  }
  /**
  after a reply on `thread`: `--working` keeps its card the agent's, a plain reply hands it back to him
  */
  function hand(held: Held, thread: Thread | undefined, isWorking?: boolean): void {
    const id = cardOf(held, thread)?.id;
    held.status.working = [
      ...held.status.working.filter((one) => one !== id),
      ...(isWorking && id ? [id] : []),
    ];
  }
  function saveStatus(slug: string, held: Held): void {
    save(`${root}/${slug}/status.json`, held.status);
  }
  /**
  a changed status, on disk and to every page
  */
  function commit(slug: string, held: Held): void {
    saveStatus(slug, held);
    publish(slug);
  }
  /**
  an owner event: logged for `show wait`, and a card he speaks on is no longer resolved
  */
  function record(slug: string, held: Held, entry: Entry): void {
    held.events.push(entry);
    appendFileSync(`${root}/${slug}/answers.jsonl`, `${JSON.stringify(entry)}\n`);
    held.status.resolved = held.status.resolved.filter((id) => id !== entry.card);
    held.status.working = held.status.working.filter((id) => id !== entry.card);
    commit(slug, held);
  }
  async function bodyOf(request: Request): Promise<Body> {
    try {
      return await request.json();
    } catch {
      return {} as Body;
    }
  }
  /**
  the card an answer is for and its message, or the refusal when the card is missing or the answer is wrong
  */
  async function parse(
    slug: string,
    request: Request,
    held: Held,
  ): Promise<Response | { card: Card; said: Said }> {
    const body = await bodyOf(request);
    const card = held.form.cards.find((one) => one.id === body.card);
    if (!card) {
      return fail('not_found', `no card ${body.card} on ${slug}`, NOT_FOUND);
    }
    // `choice` or `choices`, each an option's value: one at most unless the card picks many
    const picks = [body.choices ?? body.choice ?? []].flat();
    const said: Said = {
      choices: picked(card, picks).map((option) => option.value),
      message: typeof body.message === 'string' ? body.message.trim() : '',
      notes: Object.fromEntries(
        Object.entries(body.notes ?? {})
          .map(([value, text]) => [value, String(text).trim()])
          .filter(([value, text]) => text && picked(card, [value]).length > 0),
      ),
    };
    // a pick, a message, an option's comment or any mix: his own words alone are a full answer
    if (
      said.choices.length !== picks.length ||
      (card.pick !== 'many' && picks.length > 1) ||
      !spoken(card, said)
    ) {
      return fail(
        'invalid',
        card.options
          ? `choose one of ${card.options.map((option) => option.value).join(', ')}, or write a message`
          : 'write a message',
        BAD_REQUEST,
      );
    }
    return { card, said };
  }
  async function answer(slug: string, request: Request): Promise<Response> {
    const held = forms.get(slug) ?? none;
    const parsed = await parse(slug, request, held);
    if (parsed instanceof Response) {
      return parsed;
    }
    const { card, said } = parsed;
    const { choices, message, notes } = said;
    const at = now();
    expected.add(`/${slug} ${selectorOf(card)} ${spoken(card, said)}`);
    record(slug, held, {
      at,
      card: card.id,
      ...(choices.length > 0 && (card.pick === 'many' ? { choices } : { choice: choices[0] })),
      kind: 'answer',
      ...(message && { message }),
      ...(Object.keys(notes).length > 0 && { notes }),
    });
    return Response.json({ at });
  }
  /**
  the agent's `show resolve`: close the card's or the thread's hud threads, and collapse the card
  */
  async function settle(slug: string, held: Held, target: unknown): Promise<Response> {
    const threads = threadsOf(slug);
    const thread = threads.find((one) => one.id.startsWith(String(target)));
    const card = held.form.cards.find((one) => one.id === target) ?? cardOf(held, thread);
    if (!card && !thread) {
      return fail('not_found', `no card or thread ${target} on ${slug}`, NOT_FOUND);
    }
    await Promise.all(
      threads
        .filter(
          (one) =>
            one.status === 'open' && (one === thread || (card && cardOf(held, one) === card)),
        )
        .map((one) => hudCall('resolve', { id: one.id })),
    );
    const done = new Set(held.status.resolved);
    held.status.resolved = [...done.union(new Set(card ? [card.id] : []))];
    commit(slug, held);
    return Response.json({ resolved: card?.id ?? thread?.id });
  }
  /**
  his Resolve on a card: an event for `show wait`, then what `show resolve` does
  */
  async function shut(slug: string, request: Request): Promise<Response> {
    const held = forms.get(slug) ?? none;
    const { card } = await bodyOf(request);
    if (held.form.cards.every((one) => one.id !== card)) {
      return fail('not_found', `no card ${card} on ${slug}`, NOT_FOUND);
    }
    record(slug, held, { at: now(), card: String(card), kind: 'resolve' });
    return settle(slug, held, card);
  }
  /**
  what the page may POST to `/<slug>/<verb>`
  */
  const ACTIONS = new Map([
    ['answer', answer],
    ['resolve', shut],
  ]);

  async function render(path: string): Promise<Response> {
    const state = withThreads(path);
    const stream = await renderToReadableStream(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta content="width=device-width, initial-scale=1" name="viewport" />
          <title>{'form' in state ? state.form.title : 'show'}</title>
          <link href="/style.css" rel="stylesheet" />
        </head>
        <body>
          <div id="root">
            <App initial={state} />
          </div>
        </body>
      </html>,
      {
        bootstrapModules: ['/client.js'],
        bootstrapScriptContent: `window.__SHOW__=${JSON.stringify(state).replaceAll('<', String.raw`<`)}`,
      },
    );
    return new Response(stream, {
      headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' },
      status: 'missing' in state ? NOT_FOUND : OK,
    });
  }

  function page(
    request: Request,
    server: Bun.Server<string> | undefined,
  ): Promise<Response> | Response | undefined {
    const { pathname } = new URL(request.url);
    if (request.headers.get('upgrade') === 'websocket') {
      return server?.upgrade(request, { data: pathname })
        ? undefined
        : fail('upgrade', 'not a WebSocket', BAD_REQUEST);
    }
    const [, slug = '', verb] = pathname.split('/', PATH_PARTS);
    const asset = {
      '/client.js': ['text/javascript', live.build?.outputs[0]],
      '/style.css': ['text/css', Bun.file(`${DIR}/style.css`)],
    }[pathname];
    if (asset) {
      return new Response(asset[1] as Blob, {
        headers: { ...NO_STORE, 'content-type': `${asset[0]}; charset=utf-8` },
      });
    }
    const action = request.method === 'POST' && ACTIONS.get(String(verb));
    return action ? action(slug, request) : render(pathname);
  }

  function nextEvent(slug: string, after: number): Promise<Response> {
    return new Promise((resolve) => {
      // asks again at each wake until an entry, a close or a stop answers
      function ask(): void {
        const entry = forms.get(slug)?.events[after];
        if (entry) {
          resolve(Response.json({ ...entry, [POSITION]: after }));
        } else if (!forms.has(slug) || live.stage === 'stopping') {
          resolve(
            forms.has(slug)
              ? fail('stopping', 'show is stopping', UNAVAILABLE)
              : fail('not_found', `${slug} was closed`, NOT_FOUND),
          );
        } else {
          waiters.add(ask);
        }
      }
      ask();
    });
  }
  /**
  open a form: its directory, its first state, and what a cold boot re-reads
  */
  async function open(slug: string, form: Form, session: string): Promise<Response> {
    const held: Held = {
      events: [],
      form: await lit(form),
      status: { lines: [], opened: now(), resolved: [], session, working: [] },
    };
    mkdirSync(`${root}/${slug}`, { recursive: true });
    writeFileSync(`${root}/${slug}/answers.jsonl`, '');
    forms.set(slug, held);
    save(`${root}/${slug}/form.json`, form);
    saveStatus(slug, held);
    log(`open ${slug}`);
    publish(slug);
    return Response.json({ slug, url: `${live.url}${slug}` });
  }
  /**
  why a reply cannot go out, or nothing when exactly one thread is its target
  */
  function refusal({
    card,
    found,
    target,
    text,
  }: {
    card?: Card;
    found: Thread[];
    target: unknown;
    text: unknown;
  }): Response | undefined {
    if (!live.layer) {
      return fail('hud_off', `threads are off: ${live.reason}`, UNAVAILABLE);
    }
    if (typeof text !== 'string' || !text.trim()) {
      return fail('invalid', 'nothing to say', BAD_REQUEST);
    }
    if (found.length > 1) {
      return fail('ambiguous', `${found.length} threads match ${target}`, CONFLICT);
    }
    return found.length === 0
      ? fail(
          card ? 'no_thread' : 'not_found',
          card ? `the owner has not written on ${target} yet` : `0 threads match ${target}`,
          NOT_FOUND,
        )
      : undefined;
  }

  const control: Record<string, Handler> = {
    'DELETE /forms/:slug': ({ slug }) => {
      mkdirSync(`${root}/.closed`, { recursive: true });
      renameSync(`${root}/${slug}`, `${root}/.closed/${slug}-${Date.now()}`);
      forms.delete(slug);
      live.tcp?.publish(`/${slug}`, JSON.stringify({ closed: true, version: VERSION }));
      publish('');
      log(`close ${slug}`);
      return Response.json({ slug });
    },
    'GET /forms': () => Response.json(summaries()),
    'GET /forms/:slug/events': ({ slug, url }) =>
      nextEvent(slug, Number(url.searchParams.get('after'))),
    'GET /health': () =>
      Response.json({
        pid: process.pid,
        reason: live.reason,
        state: live.stage,
        url: live.url,
        version: VERSION,
      }),
    'POST /forms': ({
      body: {
        form,
        session = '',
        slug = String(form.title)
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/gu, '-')
          .replaceAll(/^-|-$/gu, ''),
      },
    }) => {
      const problems = [
        ...validate(form),
        ...(SLUG.test(slug)
          ? []
          : [`slug ${JSON.stringify(slug)}: lowercase letters, digits and -`]),
      ];
      if (problems.length > 0) {
        return fail('invalid', problems.join('\n'), UNPROCESSABLE);
      }
      return forms.has(slug)
        ? fail(
            'exists',
            `${slug} is open: show update ${slug} <form.json>, or open with --slug`,
            CONFLICT,
          )
        : open(slug, form, session);
    },
    'POST /forms/:slug/reply': async ({ body: { target, text, working }, held, slug }) => {
      const threads = threadsOf(slug);
      const card = held.form.cards.find((one) => one.id === target);
      const found = card
        ? threads.filter((thread) => cardOf(held, thread) === card).slice(-1)
        : threads.filter((thread) => thread.id.startsWith(String(target)));
      const refused = refusal({ card, found, target, text });
      if (refused) {
        return refused;
      }
      const reply = await hudCall('reply', { id: found[0]?.id, text });
      hand(held, found[0], working);
      commit(slug, held);
      return Response.json(reply);
    },
    'POST /forms/:slug/resolve': ({ body: { target }, held, slug }) => settle(slug, held, target),
    'PUT /forms/:slug': async ({ body: { form }, held, slug }) => {
      const problems = validate(form);
      if (problems.length > 0) {
        return fail('invalid', problems.join('\n'), UNPROCESSABLE);
      }
      held.form = await lit(form);
      save(`${root}/${slug}/form.json`, form);
      publish(slug);
      return Response.json({ slug, url: `${live.url}${slug}` });
    },
    'PUT /forms/:slug/status': ({ body: { lines }, held, slug }) => {
      if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
        return fail('invalid', 'lines: expected [string, …]', BAD_REQUEST);
      }
      Object.assign(held.status, { at: now(), lines });
      commit(slug, held);
      return Response.json({ slug });
    },
  };
  /**
  the refusal that comes before any handler runs: the version, the lifecycle, a form that is not open
  */
  function gate(request: Request, route: string, slug: string): Response | undefined {
    const said = request.headers.get('x-show-version');
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      return undefined;
    }
    if (said !== VERSION) {
      return fail('version', `daemon runs ${VERSION}, this CLI is ${said}: ${FIX}`, CONFLICT);
    }
    if (['booting', 'stopping'].includes(live.stage)) {
      return fail(live.stage, `show is ${live.stage}`, UNAVAILABLE);
    }
    return route.includes(':slug') && !forms.has(slug)
      ? fail('not_found', `no open form ${slug}`, NOT_FOUND)
      : undefined;
  }
  async function dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const slug = url.pathname.split('/', PATH_PARTS)[2] ?? '';
    const route = `${request.method} ${url.pathname.replace(/^\/forms\/[^/]+/u, '/forms/:slug')}`;
    const handler = control[route];
    if (!handler) {
      return fail('route', `no route ${route}`, NOT_FOUND);
    }
    return (
      gate(request, route, slug) ??
      handler({ body: await bodyOf(request), held: forms.get(slug) ?? none, slug, url })
    );
  }

  const sock = `${root}/show.sock`;
  rmSync(sock, { force: true });
  // a long `wait` must outlive Bun's 10 s idle cut: idleTimeout works on a Unix socket (probed), yet bun-types
  // offers it on the TCP options only
  const unix = Bun.serve({
    fetch: dispatch,
    idleTimeout: 0,
    unix: sock,
  } as unknown as Bun.Serve.Options<undefined>);

  live.build = await building;
  const staleFiles = [...TEMP_FILES.scanSync(root)];
  for (const stale of staleFiles) {
    rmSync(`${root}/${stale}`);
  }
  const formFiles = [...FORM_FILES.scanSync(root)];
  await Promise.all(
    formFiles.map(async (path) => {
      const slug = path.slice(0, -'/form.json'.length);
      const directory = `${root}/${slug}`;
      const raw = JSON.parse(readFileSync(`${directory}/form.json`, 'utf8'));
      forms.set(slug, {
        events: readFileSync(`${directory}/answers.jsonl`, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
        form: await lit(raw),
        // a status saved before `working` existed reads as none working
        status: { working: [], ...JSON.parse(readFileSync(`${directory}/status.json`, 'utf8')) },
      });
    }),
  );
  must(live.build.success, 'build', live.build.logs.join('\n'));
  /**
  the owner's own hud messages become events; the ones the page said for a Send are `answer`'s
  */
  function onChange(threads: Thread[]): void {
    for (const thread of threads) {
      const slug = thread.page.slice(1);
      const held = forms.get(slug);
      const fresh = thread.messages
        .slice(counts.get(thread.id) ?? 0)
        .filter(
          (message) =>
            message.author === 'user' &&
            !expected.delete(`${thread.page} ${thread.selector} ${message.text}`),
        );
      counts.set(thread.id, thread.messages.length);
      if (held) {
        for (const message of fresh) {
          const card = cardOf(held, thread);
          record(slug, held, {
            at: message.at,
            ...(card && { card: card.id }),
            kind: 'comment',
            text: message.text,
            thread: thread.id,
          });
        }
      }
    }
    publish('');
  }
  const websocket: Bun.WebSocketHandler<string> = {
    message: () => {
      // frames from the page carry nothing the daemon reads
    },
    open: (socket) => {
      socket.subscribe(socket.data);
      socket.send(JSON.stringify(stateOf(socket.data)));
    },
  };
  /**
  hud's server module, or nothing and the reason threads are off
  */
  async function loadHud(): Promise<((options: object) => Layer) | undefined> {
    try {
      const loaded = await import(hudPath());
      return loaded.hud;
    } catch (error) {
      live.reason = `hud: ${(error as Error).message}`;
      return undefined;
    }
  }
  const hud = await loadHud();
  Object.assign(live, {
    layer: hud?.({ fetch: page, onChange, store: `${root}/threads.json`, websocket }),
  });
  const hudThreads = live.layer?.threads() ?? [];
  for (const thread of hudThreads) {
    counts.set(thread.id, thread.messages.length);
  }
  const served = live.layer ?? { fetch: page, websocket };
  const tcp = Bun.serve<string>({
    fetch: (request, server) => {
      const allowed = new Set([`127.0.0.1:${server.port}`, `localhost:${server.port}`]);
      const origin = request.headers.get('origin');
      return !allowed.has(String(request.headers.get('host'))) ||
        (origin !== null && !allowed.has(origin.replace(/^http:\/\//u, '')))
        ? fail(
            'origin',
            `refused: Host ${request.headers.get('host')}, Origin ${origin}`,
            FORBIDDEN,
          )
        : served.fetch(request, server);
    },
    hostname: '127.0.0.1',
    port: port ?? Number(SHOW_PORT ?? DEFAULT_PORT),
    websocket: served.websocket,
  });
  live.tcp = tcp;
  live.url = `http://127.0.0.1:${tcp.port}/`;

  /**
  every signal and panic listener, kept so a stop can take them all off
  */
  const listeners = new Map<string, (error: Error) => unknown>();
  /**
  wait until no request is in flight or the deadline passes
  */
  async function drain(deadline: number): Promise<void> {
    if (tcp.pendingRequests + unix.pendingRequests === 0 || Date.now() >= deadline) {
      return;
    }
    await Bun.sleep(DRAIN_POLL_MS);
    await drain(deadline);
  }
  /**
  the last of a stop: take every listener off, say why, let go of the lock
  */
  function release(reason: string): void {
    for (const [event, listener] of listeners) {
      process.off(event, listener);
    }
    log(`exit ${reason}`);
    closeSync(lock);
  }
  async function stop(reason: string): Promise<void> {
    if (live.stage === 'stopping') {
      return;
    }
    live.stage = 'stopping';
    wake();
    // stop accepting, let in-flight requests finish inside the budget, then close every socket, hud's too
    const accepting = tcp.stop();
    await drain(Date.now() + BUDGET_MS);
    await Promise.all([accepting, tcp.stop(true), unix.stop(true)]);
    release(reason);
  }
  for (const signal of SIGNALS) {
    listeners.set(signal, () => stop(signal));
  }
  for (const panic of PANICS) {
    listeners.set(panic, (error: Error) => {
      log(`panic ${error.stack ?? error}`);
      process.exitCode = 1;
      return stop('panic');
    });
  }
  for (const [event, listener] of listeners) {
    process.on(event, listener);
  }
  live.stage = live.layer ? 'ready' : 'degraded';
  log(`${live.stage} ${live.url}${live.reason && ` ${live.reason}`}`);
  return { stop, url: live.url };
}

export { serve };
