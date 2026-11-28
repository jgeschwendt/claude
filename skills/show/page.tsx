// The page, rendered on the server and hydrated in the browser from the same state: the index of open plans,
// or one plan's questions. Live changes arrive as whole states through `publish`.
import {
  type ReactElement,
  type ReactNode,
  useActionState,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFormStatus } from 'react-dom';
import {
  unknown as anything,
  is,
  list,
  literal,
  object,
  optional,
  parse,
  record,
  scalar,
  string,
  tuple,
  union,
} from 'verax';
import { loose } from '#loose';
import {
  type Asked,
  type Choice,
  type Plan,
  type Said,
  asking,
  byChoice,
  choicesOf,
  optionsOf,
  partOf,
  picked,
  spoken,
} from './catalog.tsx';
import { entryShape, statusShape, summaryShape, threadShape } from './shapes.ts';

/**
what he sent on a question: an answer is his picks, option comments and message
*/
type Answer = Partial<Said> & { at: string; question: string };
/**
an event of his, as `show wait` prints it and answers.jsonl stores it: its kind, then its props
*/
type Entry =
  | ['answer', Answer]
  | ['comment', { at: string; question?: string; text: string; thread: string }]
  | ['resolve', { at: string; question: string }];
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
whose move a question waits on: his, the agent's because he spoke last, the agent's by its own `--working` reply, or
no one's
*/
type Turn = 'resolved' | 'waiting' | 'working' | 'yours';
type Summary = Record<Exclude<Turn, 'resolved'>, number> & {
  session: string;
  slug: string;
  title: string;
  url: string;
};
/**
the question's horizontal and vertical place in a hud thread, in percent of the question
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
    | { events: Entry[]; plan: Plan; slug: string; status: Status }
    | { missing?: string; plans: Summary[] }
  );

const shared = { threads: optional(list(threadShape)), version: string() };
const drawn = tuple([string(), list(anything()), record(anything())]);
const planFrame = loose('plan state', {
  ...shared,
  events: list(entryShape),
  plan: drawn,
  slug: string(),
  status: statusShape,
});
const indexFrame = loose('index state', {
  ...shared,
  missing: optional(string()),
  plans: list(summaryShape),
});
/**
a frame of the server's state: a plan's (drawn on, so only its three parts), the index's or a close frame
*/
const frameShape = union('state', [
  planFrame,
  indexFrame,
  loose('close frame', { closed: literal(true), version: string() }),
]);
const stateShape = scalar('state', (value: unknown): value is State => is(value, frameShape));
const live: { listeners: Set<() => void>; state?: State | undefined } = { listeners: new Set() };
/**
the error a daemon's refusal carries
*/
const refusal = object('refusal', {
  error: object('error', { code: string(), message: string() }),
});
/**
whether a document event carries hud's threads
*/
function isThreads(event: Event): event is CustomEvent<{ threads: Thread[] }> {
  return event.type === 'hud:threads';
}
/**
replace the page's state (a frame from the socket) or merge hud's threads into it
*/
function publish(next: State | { threads: Thread[] }): void {
  // a frame from the socket carries no threads, and a close frame no plan, so what hud and the page last had stays
  const merged = { ...live.state, ...next };
  if ('version' in merged) {
    live.state = merged;
  }
  for (const listener of live.listeners) {
    listener();
  }
}
function subscribe(listener: () => void): () => void {
  live.listeners.add(listener);
  return () => {
    live.listeners.delete(listener);
  };
}
function selectorOf(question: Asked): string {
  return `#question-${question.id}`;
}
/**
the question's newest hud thread on the plan at `slug`
*/
function threadOf(slug: string, question: Asked, threads: Thread[] = []): Thread | undefined {
  return threads.findLast(
    (one) => one.page === `/${slug}` && one.selector === selectorOf(question),
  );
}
function turnOf(question: Asked, status: Status, thread?: Thread): Turn {
  if (status.resolved.includes(question.id)) {
    return 'resolved';
  }
  if (status.working.includes(question.id)) {
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
a button that sends: Ask sends the whole question, picks, option comments and message; with `only` (a choice id) the
tall ↵ beside a pick-many choice's options sends just that choice's picks and comments
*/
function Send({
  glyph,
  label,
  only,
}: Readonly<{ glyph?: string; label: string; only?: string }>): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button
      aria-label={label}
      disabled={pending}
      name={only === undefined ? 'verb' : 'only'}
      type="submit"
      value={only ?? 'answer'}
    >
      {pending ? '…' : (glyph ?? label)}
    </button>
  );
}

/**
say `text` on the question's hud thread as the owner (the daemon expects it, so it is no second event), and settle
once hud's threads carry it or SETTLE_MS pass
*/
async function say(question: Asked, thread: Thread | undefined, text: string): Promise<void> {
  return new Promise((settle) => {
    const host = document.querySelector('hud');
    const count = thread?.messages.length ?? 0;
    const finish = new AbortController();
    function heard(event: Event): void {
      if (
        isThreads(event) &&
        event.detail.threads.some(
          (one) =>
            one.page === location.pathname &&
            one.selector === selectorOf(question) &&
            one.messages.length > count,
        )
      ) {
        finish.abort();
      }
    }
    const timer = setTimeout(
      () => {
        finish.abort();
      },
      host ? SETTLE_MS : 0,
    );
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
          : { selector: selectorOf(question), text, via: 'show', x: HUD_X, y: HUD_Y },
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
    return Response.json(
      { error: { code: 'down', message: 'show is down' } },
      { status: UNAVAILABLE },
    );
  }
}

/**
the owner's last answer on a question
*/
function lastAnswer(question: Asked, events: Entry[]): Answer | undefined {
  return events.findLast(
    (entry): entry is ['answer', Answer] =>
      entry[0] === 'answer' && entry[1].question === question.id,
  )?.[1];
}
/**
the owner's last answer on a question, its labels or else his message, set after the title once resolved
*/
function chosenSuffix(question: Asked, events: Entry[]): string {
  const last = lastAnswer(question, events);
  const said =
    choicesOf(question)
      .flatMap((one) => picked(one, last?.picks?.[one.id] ?? []))
      .map((option) => option.label)
      .join(', ') || last?.message;
  return said === undefined || said === '' ? '' : ` · ${said}`;
}
/**
the text of a form field, empty when it is absent or a file
*/
function fieldOf(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

/**
what a submit of the question's form says: an option's own ↵ sends `<choice id>:<value>`, a pick-many choice's tall ↵
its choice id, just that much; Ask sends every choice
*/
function saidOf(question: Asked, data: FormData): Said {
  const only = fieldOf(data, 'only');
  const [target = ''] = only.split(':', 1);
  const value = only.slice(target.length + 1);
  const sent = choicesOf(question).filter((one) => target === '' || one.id === target);
  return {
    message: fieldOf(data, 'message').trim(),
    // each option's own comment, only the ones he wrote
    notes: byChoice(sent, (one) =>
      Object.fromEntries(
        optionsOf(one)
          .filter((option) => value === '' || option.value === value)
          .map(
            (option) =>
              [option.value, fieldOf(data, `note:${one.id}:${option.value}`).trim()] as const,
          )
          .filter(([, text]) => text !== ''),
      ),
    ),
    picks: byChoice(sent, (one) =>
      value === '' ? data.getAll(`pick:${one.id}`).map(String) : [value],
    ),
  };
}

/**
a choice's options where it sits in the question's body: a pick-one option comments and sends itself (✎ becomes ↵), a
pick-many choice sends once, beside them all
*/
function ChoiceView({
  choice,
  chosen,
  id,
  open,
  setChosen,
  setOpen,
}: Readonly<{
  choice: Choice;
  chosen: Record<string, string[]>;
  id: string;
  open: string;
  setChosen: (picks: Record<string, string[]>) => void;
  setOpen: (value: string) => void;
}>): ReactNode {
  const isMany = choice.pick === 'many';
  return (
    <fieldset>
      <div className="picks">
        {optionsOf(choice).map(({ hint, label, lean, shape, value }) => (
          <div className={open === `${choice.id}:${value}` ? 'pick open' : 'pick'} key={value}>
            <label className="option">
              <input
                checked={(chosen[choice.id] ?? []).includes(value)}
                name={`pick:${choice.id}`}
                // a second tap takes a pick back; a pick-one choice holds one at a time
                onClick={() => {
                  const now = chosen[choice.id] ?? [];
                  const others = isMany ? now.filter((one) => one !== value) : [];
                  setChosen({
                    ...chosen,
                    [choice.id]: now.includes(value) ? others : [...others, value],
                  });
                }}
                readOnly
                type={isMany ? 'checkbox' : 'radio'}
                value={value}
              />
              {shape === undefined ? undefined : (
                <svg className="shape" role="img" viewBox="0 0 100 100">
                  <path d={shape} />
                </svg>
              )}
              <span>
                {label}
                {lean ? ' ★' : undefined}
                {hint === undefined ? undefined : <small>{hint}</small>}
              </span>
            </label>
            {isMany ? undefined : (
              <>
                <input
                  aria-label={`Comment on ${label}`}
                  id={`note-${id}-${choice.id}-${value}`}
                  name={`note:${choice.id}:${value}`}
                  onFocus={() => {
                    setOpen(`${choice.id}:${value}`);
                  }}
                  // Enter would press the form's first button, so press this option's own
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return;
                    }
                    event.preventDefault();
                    const { nextElementSibling } = event.currentTarget;
                    event.currentTarget.form?.requestSubmit(
                      nextElementSibling instanceof HTMLElement ? nextElementSibling : undefined,
                    );
                  }}
                  placeholder={`About ${label}`}
                />
                <button
                  aria-label={`Send ${label}`}
                  name="only"
                  type="submit"
                  value={`${choice.id}:${value}`}
                >
                  {'↵'}
                </button>
                {/* the label focuses the input, which opens it: the ✎ gives way to the ↵ */}
                <label
                  aria-label={`Comment on ${label}`}
                  className="aside"
                  htmlFor={`note-${id}-${choice.id}-${value}`}
                >
                  {'✎'}
                </label>
              </>
            )}
          </div>
        ))}
      </div>
      {isMany ? (
        <Send glyph="↵" label={`Send ${choice.title ?? choice.id}`} only={choice.id} />
      ) : undefined}
    </fieldset>
  );
}

function QuestionView({
  events,
  question,
  thread,
}: Readonly<{
  events: Entry[];
  question: Asked;
  thread: Thread | undefined;
}>): ReactNode {
  const answer = lastAnswer(question, events);
  const [chosen, setChosen] = useState(answer?.picks ?? {});
  // the option whose ✎ comment is open, as `<choice id>:<value>`
  const [open, setOpen] = useState('');
  const [problem, action] = useActionState(async (_previous: string, data: FormData) => {
    const said = saidOf(question, data);
    const [target = ''] = fieldOf(data, 'only').split(':', 1);
    // the button pressed names the verb; an option's ↵ is an answer
    const verb = target === '' ? fieldOf(data, 'verb') : 'answer';
    const response = await post(verb, { question: question.id, ...said });
    const reply: unknown = await response.json();
    if (!response.ok) {
      return `not sent: ${parse(reply, refusal).error.message}`;
    }
    // a resolve says nothing on hud: it closes the question's threads instead
    if (verb === 'answer') {
      await say(question, thread, spoken(question, said));
    }
    return '';
  }, '');
  return (
    <article className="question" id={`question-${question.id}`}>
      <h2>{question.title}</h2>
      <form action={action}>
        {question.body.map((item, index) => (
          <div className="part" key={index}>
            {item[1].title === undefined ? undefined : <h3>{item[1].title}</h3>}
            {item[0] === 'choice' ? (
              <ChoiceView
                choice={item[1]}
                chosen={chosen}
                id={question.id}
                open={open}
                setChosen={setChosen}
                setOpen={setOpen}
              />
            ) : (
              partOf(item)
            )}
          </div>
        ))}
        {thread === undefined ? undefined : (
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
        )}
        <textarea
          aria-label={`Message about ${question.title}`}
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
        {problem === '' ? undefined : <p role="alert">{problem}</p>}
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
  if (!('plan' in state)) {
    return (
      <main>
        <h1>{'show'}</h1>
        {state.missing === undefined || state.missing === '' ? undefined : (
          <p className="meta">{`No open plan at /${state.missing}.`}</p>
        )}
        <ul className="plans">
          {state.plans.map((one) => (
            <li className="question" key={one.slug}>
              <a href={`/${one.slug}`}>
                <strong>{one.title}</strong>
                <span className="meta">
                  {`${one.yours} your turn · ${one.waiting} waiting on the agent · ${one.working} agent working · session ${one.session.slice(0, SHORT_ID)}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {state.plans.length === 0 ? <p>{'No open plans.'}</p> : undefined}
      </main>
    );
  }
  const { events, plan, slug, status } = state;
  const [title, overview] = plan;
  const questions = asking(plan);
  function thread(question: Asked): Thread | undefined {
    return threadOf(slug, question, state.threads);
  }
  function view(question: Asked): ReactElement {
    return (
      <QuestionView
        events={events}
        key={question.id}
        question={question}
        thread={thread(question)}
      />
    );
  }
  function replied(question: Asked): number {
    return Number(thread(question)?.messages.at(-1)?.author === 'agent');
  }
  const {
    resolved = [],
    waiting,
    working,
    yours,
  } = Object.groupBy(questions, (question) => turnOf(question, status, thread(question)));
  return (
    <main>
      <header>
        <a className="back" href="/">
          {'← All plans'}
        </a>
        <h1>{title}</h1>
        <p className="meta">{'Tap a choice, write to the agent, send any question at any time.'}</p>
      </header>
      <section className="overview">
        {overview.map((item, index) => (
          <figure key={index}>
            {item[1].title === undefined ? undefined : <h2>{item[1].title}</h2>}
            {partOf(item)}
          </figure>
        ))}
      </section>
      {/* where things stand, then every question as a task: a link to it, checked once resolved */}
      <section className="tasks">
        <h2>
          {`Tasks · ${resolved.length}/${questions.length} `}
          {status.at === undefined ? undefined : <Time at={status.at} />}
        </h2>
        <ul className="meta">
          {status.lines.map((line, index) => (
            <li key={`${index}`}>{line}</li>
          ))}
        </ul>
        <ul>
          {questions.map((question) => (
            <li key={question.id}>
              <a href={`#question-${question.id}`}>
                {`${resolved.includes(question) ? '☑' : '☐'} ${question.title}`}
              </a>
            </li>
          ))}
        </ul>
      </section>
      {/* his turn first, a fresh reply on top; then the questions that are the agent's, either way */}
      {yours?.toSorted((one, two) => replied(two) - replied(one)).map((question) => view(question))}
      {(
        [
          ['working', 'Agent working', working],
          ['waiting', 'Waiting on the agent', waiting],
        ] as const
      ).map(([name, heading, group]) =>
        group === undefined ? undefined : (
          <section className={name} key={name}>
            <h2>{`${heading} · ${group.length}`}</h2>
            {group.map((question) => view(question))}
          </section>
        ),
      )}
      {resolved.length > 0 ? (
        <section className="resolved">
          <h2>{`Resolved · ${resolved.length}`}</h2>
          {resolved.map((question) => (
            <details key={question.id}>
              <summary>
                {`✓ ${question.title}`}
                {chosenSuffix(question, events)}
              </summary>
              {view(question)}
            </details>
          ))}
        </section>
      ) : undefined}
    </main>
  );
}

export { App, isThreads, publish, selectorOf, stateShape, threadOf, turnOf };
export type { Entry, State, Status, Summary, Thread, Turn };
