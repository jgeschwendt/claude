// The page, rendered on the server and hydrated in the browser from the same state: the index of open forms,
// or one form's cards. Live changes arrive as whole states through `publish`.
import { type ReactNode, useActionState, useState, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { BODIES, type Card, type Form, picked, spoken } from './catalog.tsx';

type Entry = {
  at: string;
  card?: string;
  choice?: string;
  choices?: string[];
  kind: 'answer' | 'comment' | 'resolve';
  message?: string;
  notes?: Record<string, string>;
  text?: string;
  thread?: string;
};
type Status = {
  at?: string;
  lines: string[];
  opened: string;
  resolved: string[];
  session: string;
  working: string[];
};
type Thread = {
  id: string;
  messages: { at: string; author: 'agent' | 'user'; text: string }[];
  page: string;
  selector: string;
  status: 'open' | 'resolved';
};
/**
whose move a card waits on: his, the agent's because he spoke last, the agent's by its own `--working` reply, or no one's
*/
type Turn = 'resolved' | 'waiting' | 'working' | 'yours';
type Summary = Record<Exclude<Turn, 'resolved'>, number> & {
  session: string;
  slug: string;
  title: string;
  url: string;
};
/**
the card's horizontal and vertical place in a hud thread, in percent of the card
*/
const HUD_X = 98;
const HUD_Y = 2;
/**
the leading characters of a session shown to a person
*/
const SHORT_ID = 8;
/**
the status of a request the daemon could not be asked
*/
const UNAVAILABLE = 503;
/**
how long a Send waits for hud's threads to carry what it said
*/
const SETTLE_MS = 3000;
type Shared = { closed?: true; threads?: Thread[]; version: string };
type State = Shared &
  (
    | { events: Entry[]; form: Form; slug: string; status: Status }
    | { forms: Summary[]; missing?: string }
  );

const live: { listeners: Set<() => void>; state?: State } = { listeners: new Set() };
/**
replace the page's state (a frame from the socket) or merge part of it (threads from hud)
*/
function publish(next: Partial<State>): void {
  live.state = { ...live.state, ...next } as State;
  for (const listener of live.listeners) {
    listener();
  }
}
function subscribe(listener: () => void): () => void {
  live.listeners.add(listener);
  return () => live.listeners.delete(listener);
}
function selectorOf(card: Card): string {
  return `#card-${card.id}`;
}
/**
the card's newest hud thread on the form at `slug`
*/
function threadOf(slug: string, card: Card, threads: Thread[] = []): Thread | undefined {
  return threads.findLast((one) => one.page === `/${slug}` && one.selector === selectorOf(card));
}
function turnOf(card: Card, status: Status, thread?: Thread): Turn {
  if (status.resolved.includes(card.id)) {
    return 'resolved';
  }
  if (status.working.includes(card.id)) {
    return 'working';
  }
  return thread?.messages.at(-1)?.author === 'user' ? 'waiting' : 'yours';
}

/**
a clock time in the reader's zone; the server's render may differ by zone, so the text is not hydrated
*/
function Time({ at }: Readonly<{ at: string }>): ReactNode {
  const date = new Date(at);
  return (
    <time dateTime={at} suppressHydrationWarning>
      {date.toLocaleTimeString([], { hour: '2-digit', hour12: false, minute: '2-digit' })}
    </time>
  );
}

/**
a button that sends the whole card, picks, option comments and message: Send under a pick-many card's options, Ask by the message
*/
function Send({ label }: Readonly<{ label: string }>): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} name="verb" type="submit" value="answer">
      {pending ? 'Sending…' : label}
    </button>
  );
}

/**
say `text` on the card's hud thread as the owner (the daemon expects it, so it is no second event), and settle
once hud's threads carry it or SETTLE_MS pass
*/
function say(card: Card, thread: Thread | undefined, text: string): Promise<void> {
  return new Promise((settle) => {
    const host = document.querySelector('hud');
    const count = thread?.messages.length ?? 0;
    const finish = new AbortController();
    function heard(event: Event): void {
      const { threads } = (event as CustomEvent<{ threads: Thread[] }>).detail;
      if (
        threads.some(
          (one) =>
            one.page === location.pathname &&
            one.selector === selectorOf(card) &&
            one.messages.length > count,
        )
      ) {
        finish.abort();
      }
    }
    const timer = setTimeout(() => finish.abort(), host ? SETTLE_MS : 0);
    finish.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      host?.removeEventListener('hud:threads', heard);
      settle();
    });
    host?.addEventListener('hud:threads', heard);
    host?.dispatchEvent(
      new CustomEvent(thread ? 'hud:reply' : 'hud:open', {
        detail: thread
          ? { id: thread.id, text, via: 'show' }
          : { selector: selectorOf(card), text, via: 'show', x: HUD_X, y: HUD_Y },
      }),
    );
  });
}

/**
one POST to the daemon, a Send's `answer` or his `resolve`; a daemon that is down answers as a refusal would
*/
async function post(verb: string, body: object): Promise<Response> {
  try {
    return await fetch(`${location.pathname}/${verb}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return Response.json({ error: { message: 'show is down' } }, { status: UNAVAILABLE });
  }
}

/**
the values of the owner's last answer on a card: `choice` on a pick-one card, `choices` on a pick-many one
*/
function lastPicks(card: Card, events: Entry[]): string[] {
  const last = events.findLast((event) => event.kind === 'answer' && event.card === card.id);
  return [last?.choices ?? last?.choice ?? []].flat();
}
/**
the owner's last answer on a card, its options' labels or else his message, set after its title when it is resolved
*/
function chosenSuffix(card: Card, events: Entry[]): string {
  const last = events.findLast((event) => event.kind === 'answer' && event.card === card.id);
  const said =
    picked(card, lastPicks(card, events))
      .map((option) => option.label)
      .join(', ') || last?.message;
  return said ? ` · ${said}` : '';
}

function CardView({
  card,
  events,
  thread,
}: Readonly<{
  card: Card;
  events: Entry[];
  thread: Thread | undefined;
}>): ReactNode {
  const answer = events.findLast((event) => event.kind === 'answer' && event.card === card.id);
  const isMany = card.pick === 'many';
  const [chosen, setChosen] = useState(lastPicks(card, events));
  // the option whose ✎ comment is open
  const [open, setOpen] = useState('');
  const [problem, action] = useActionState(async (_previous: string, data: FormData) => {
    // an option's own ↵ sends just that option and its comment
    const only = data.get('only');
    const said = {
      choices: only ? [only] : data.getAll('choice'),
      message: String(data.get('message')).trim(),
      // each option's own comment, only the ones he wrote
      notes: Object.fromEntries(
        (card.options ?? [])
          .filter(({ value }) => !only || value === only)
          .map(({ value }) => [value, String(data.get(`note-${value}`)).trim()])
          .filter(([, text]) => text),
      ),
    };
    // the button pressed names the verb; an option's ↵ is an answer
    const verb = only ? 'answer' : String(data.get('verb'));
    const response = await post(verb, { card: card.id, ...said });
    const reply = await response.json();
    if (!response.ok) {
      return `not sent: ${reply.error.message}`;
    }
    // a resolve says nothing on hud: it closes the card's threads instead
    await (verb === 'answer' && say(card, thread, spoken(card, said)));
    return '';
  }, '');
  return (
    <article className="card" id={`card-${card.id}`}>
      <h2>{card.title}</h2>
      {card.meta ? <p className="meta">{card.meta}</p> : undefined}
      {card.text ? <p>{card.text}</p> : undefined}
      {BODIES[card.component]?.(card as never)}
      {thread ? (
        <ol className="thread">
          {thread.messages.map((message, index) => (
            <li className={message.author} key={`${index}`}>
              <small>
                {message.author === 'agent' ? 'agent' : 'you'}
                {' · '}
                <Time at={message.at} />
              </small>
              {message.text}
            </li>
          ))}
        </ol>
      ) : undefined}
      <form action={action}>
        {card.options ? (
          <fieldset>
            {card.options.map(({ hint, label, lean, shape, value }) => (
              <div className={open === value ? 'pick open' : 'pick'} key={value}>
                <label className="option">
                  <input
                    checked={chosen.includes(value)}
                    name="choice"
                    // a second tap takes a pick back; a pick-one card holds one at a time
                    onClick={() => {
                      const others = isMany ? chosen.filter((one) => one !== value) : [];
                      setChosen(chosen.includes(value) ? others : [...others, value]);
                    }}
                    readOnly
                    type={isMany ? 'checkbox' : 'radio'}
                    value={value}
                  />
                  {shape ? (
                    <svg className="shape" role="img" viewBox="0 0 100 100">
                      <path d={shape} />
                    </svg>
                  ) : undefined}
                  <span>
                    {label}
                    {lean ? ' ★' : undefined}
                    {hint ? <small>{hint}</small> : undefined}
                  </span>
                </label>
                <input
                  aria-label={`Comment on ${label}`}
                  id={`note-${card.id}-${value}`}
                  name={`note-${value}`}
                  onFocus={() => setOpen(value)}
                  // a pick-one card: Enter would press the form's first button, so press this option's own
                  onKeyDown={(event) => {
                    if (isMany || event.key !== 'Enter') {
                      return;
                    }
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit(
                      event.currentTarget.nextElementSibling as HTMLButtonElement,
                    );
                  }}
                  placeholder={`About ${label}`}
                />
                {isMany ? undefined : (
                  <button aria-label={`Send ${label}`} name="only" type="submit" value={value}>
                    {'↵'}
                  </button>
                )}
                {/* the label focuses the input, which opens it: a pick-one's ✎ gives way to the ↵ */}
                <label
                  aria-label={`Comment on ${label}`}
                  className="aside"
                  htmlFor={`note-${card.id}-${value}`}
                >
                  {'✎'}
                </label>
              </div>
            ))}
            {isMany ? <Send label="Send" /> : undefined}
          </fieldset>
        ) : undefined}
        <textarea
          aria-label={`Message about ${card.title}`}
          name="message"
          placeholder="Message the agent"
          rows={2}
        />
        <div className="row">
          <Send label="Ask" />
          <button className="settle" formNoValidate name="verb" type="submit" value="resolve">
            {'Resolve'}
          </button>
          {answer ? (
            <span>
              {'sent '}
              <Time at={answer.at} />
              {' · send again any time'}
            </span>
          ) : undefined}
        </div>
        {problem ? <p role="alert">{problem}</p> : undefined}
      </form>
    </article>
  );
}

function App({ initial }: Readonly<{ initial: State }>): ReactNode {
  const state = useSyncExternalStore(
    subscribe,
    () => live.state ?? initial,
    () => initial,
  );
  if (!('form' in state)) {
    return (
      <main>
        <h1>{'show'}</h1>
        {state.missing ? <p className="meta">{`No open form at /${state.missing}.`}</p> : undefined}
        <ul className="forms">
          {state.forms.map((one) => (
            <li className="card" key={one.slug}>
              <a href={`/${one.slug}`}>
                <strong>{one.title}</strong>
                <span className="meta">
                  {`${one.yours} your turn · ${one.waiting} waiting on the agent · ${one.working} agent working · session ${one.session.slice(0, SHORT_ID)}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {state.forms.length === 0 ? <p>{'No open forms.'}</p> : undefined}
      </main>
    );
  }
  const { events, form, slug, status } = state;
  function thread(card: Card): Thread | undefined {
    return threadOf(slug, card, state.threads);
  }
  function view(card: Card): ReactNode {
    return <CardView card={card} events={events} key={card.id} thread={thread(card)} />;
  }
  function replied(card: Card): number {
    return Number(thread(card)?.messages.at(-1)?.author === 'agent');
  }
  const {
    resolved = [],
    waiting,
    working,
    yours,
  } = Object.groupBy(form.cards, (card) => turnOf(card, status, thread(card)));
  return (
    <main>
      <header>
        <a className="back" href="/">
          {'← All forms'}
        </a>
        <h1>{form.title}</h1>
        {form.text ? <p>{form.text}</p> : undefined}
        <p className="meta">{'Tap a choice, write to the agent, send any card at any time.'}</p>
      </header>
      <section className="overview">
        {form.overview?.map((block, index) => (
          <figure key={index}>
            <h2>{block.title}</h2>
            {block.text ? <p>{block.text}</p> : undefined}
            {BODIES[block.component]?.(block as never)}
          </figure>
        ))}
      </section>
      <section className="card standing">
        <h2>
          {'Where things stand '}
          {status.at ? <Time at={status.at} /> : undefined}
        </h2>
        {status.lines.length > 0 ? (
          <ul>
            {status.lines.map((line, index) => (
              <li key={`${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="meta">{'Nothing yet.'}</p>
        )}
      </section>
      {/* his turn first, a fresh reply on top; then the cards that are the agent's, either way */}
      {yours?.toSorted((one, two) => replied(two) - replied(one)).map((card) => view(card))}
      {(
        [
          ['working', 'Agent working', working],
          ['waiting', 'Waiting on the agent', waiting],
        ] as const
      ).map(([name, title, cards]) =>
        cards ? (
          <section className={name} key={name}>
            <h2>{`${title} · ${cards.length}`}</h2>
            {cards.map((card) => view(card))}
          </section>
        ) : undefined,
      )}
      {resolved.length > 0 ? (
        <section className="resolved">
          <h2>{`Resolved · ${resolved.length}`}</h2>
          {resolved.map((card) => (
            <details key={card.id}>
              <summary>
                {`✓ ${card.title}`}
                {chosenSuffix(card, events)}
              </summary>
              {view(card)}
            </details>
          ))}
        </section>
      ) : undefined}
    </main>
  );
}

export { App, publish, selectorOf, threadOf, turnOf };
export type { Entry, State, Status, Summary, Thread, Turn };
