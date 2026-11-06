/**
The System One client: one request asks every question at once, TypeSafe first, Kev as fallback, nothing when both are down. Neither documents a balance, so availability is learned into the `gate` atom: a free `GET /v1/models` at session start, then each real call's outcome. Every `$`-taking function is a declaration: past an import the engine follows `$` only into one (`claude plugin validate`)
*/
import {
  type EngineInterface,
  type HttpResponse,
  type PluginState,
  atom,
  read,
  update,
} from 'claude-code';
import { field } from './gauge';

type Availability = Gate[Name];
type Gate = PluginState['subether']['gate'];
type Name = keyof Gate;

/**
what a judge answered: the yes-probability per question, who answered, and the billable input tokens it reported
*/
type Verdict = { judge: Name; markers: Record<string, number>; tokens?: number };

const gate = atom({ key: 'gate', plugin: 'subether' } as const, {
  kev: { why: '' },
  typesafe: { why: '' },
});

/**
how long a judge stays down with no Retry-After to say: after a failed call, a timeout, a 429/529 without the header
*/
const DOWN_MS = 60_000;
const KEV_MS = 5000;
const MS = 1000;
const PROBE_MS = 1000;
/**
down "for the session": `until` past any clock
*/
const SESSION = Number.MAX_SAFE_INTEGER;
const FORBIDDEN = 403;
const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';
const OVERLOADED = 529;
const TIMED_OUT = 'timed out';
const TOO_MANY = 429;
const TYPESAFE_MS = 3000;
const UNAUTHORIZED = 401;
/**
each judge's endpoint, model (the name its `GET /v1/models` lists) and timeout per System One call
*/
const JUDGES = {
  kev: { model: 'kev-latest', timeoutMs: KEV_MS, url: 'http://127.0.0.1:1703/v1' },
  typesafe: { model: 'jev-latest', timeoutMs: TYPESAFE_MS, url: 'https://api.typesafe.ai/v1' },
} as const;

/**
How long a 429/529 keeps the judge down: Retry-After in seconds or as an HTTP-date (IMF-fixdate, `Wed, 21 Oct 2026 07:28:00 GMT`, which Temporal does not parse as is), else 60 s
*/
function retryMs(response: HttpResponse, now: number): number {
  const after = (response.headers['retry-after'] ?? '').trim();
  if (/^\d+$/u.test(after)) {
    return Number(after) * MS;
  }
  const date = /^\w{3}, (?<day>\d{2}) (?<month>\w{3}) (?<year>\d{4}) (?<time>[\d:]{8}) GMT$/u.exec(
    after,
  )?.groups;
  const month = MONTHS.indexOf(date?.month ?? '-') / 'Jan'.length + 1;
  if (date === undefined || !Number.isSafeInteger(month)) {
    return DOWN_MS;
  }
  const iso = `${date.year}-${String(month).padStart(2, '0')}-${date.day}T${date.time}Z`;
  return Math.max(0, Temporal.Instant.from(iso).epochMilliseconds - now);
}

/**
What a response that is not an answer says of its judge: 401/403 down for the session, 429/529 for its Retry-After, any other 60 s
*/
function downOf(response: HttpResponse, now: number): Required<Availability> {
  const { status } = response;
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    return { until: SESSION, why: `key refused (${status})` };
  }
  if (status === TOO_MANY || status === OVERLOADED) {
    const why = status === TOO_MANY ? 'rate limited' : 'overloaded';
    return { until: now + retryMs(response, now), why };
  }
  return { until: now + DOWN_MS, why: `status ${status}` };
}

/**
A body as JSON, undefined when it is not
*/
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
The yes-probability of every question asked, from `answers.<name>.noul`; undefined when one is missing
*/
function answersOf(reply: unknown, names: readonly string[]): Record<string, number> | undefined {
  const answers = field(reply, 'answers');
  const entries = names.map((name): [string, unknown] => [
    name,
    field(field(answers, name), 'noul'),
  ]);
  return entries.every((entry): entry is [string, number] => typeof entry[1] === 'number')
    ? Object.fromEntries(entries)
    : undefined;
}

/**
A rejection's first line: its message, else its text
*/
function reasonOf(error: unknown): string {
  return String(field(error, 'message') ?? error).split('\n', 1)[0] ?? '';
}

/**
`work`, or a rejection `timed out` after `ms` on `$.clock`: `$.http.fetch` takes no timeout of its own
*/
async function within(
  $: EngineInterface,
  ms: number,
  work: Promise<HttpResponse>,
): Promise<HttpResponse> {
  return await new Promise((resolve, reject) => {
    const timer = $.clock.after(ms, () => {
      reject(new Error(TIMED_OUT));
    });
    work
      .then(resolve)
      .catch(reject)
      .finally(() => {
        timer.cancel();
      });
  });
}

/**
Records `name` up (no `until`) or down until `until`, a down one logged with why in one dim line
*/
async function mark($: EngineInterface, name: Name, availability: Availability): Promise<void> {
  await update($, gate, (was) => ({ ...was, [name]: availability }));
  $.ui.invalidate('ui.render');
  if (availability.until !== undefined) {
    $.ui.log(`subether judge: ${name} down (${availability.why})`);
  }
}

/**
The judge's request headers, TypeSafe's bearer among them; undefined when TypeSafe has no key, marked down for the session
*/
async function headersOf(
  $: EngineInterface,
  name: Name,
): Promise<Record<string, string> | undefined> {
  const key = name === 'kev' ? '' : await $.env.get('TYPESAFE_API_KEY');
  if (name === 'kev') {
    return {};
  }
  if (key === undefined || key === '') {
    await mark($, name, { until: SESSION, why: 'no TYPESAFE_API_KEY' });
    return undefined;
  }
  return { authorization: `Bearer ${key}` };
}

/**
A request that never came back: its judge down 60 s, why its rejection's first line, a Kev timeout `busy`
*/
async function failed($: EngineInterface, name: Name, error: unknown): Promise<undefined> {
  const reason = reasonOf(error);
  const why = name === 'kev' && reason === TIMED_OUT ? 'busy' : reason;
  await mark($, name, { until: (await $.clock.now()) + DOWN_MS, why });
}

/**
One request to one judge within `ms`: the response when one came back, else the judge marked down 60 s (a Kev timeout as `busy`) and undefined
*/
async function call(
  $: EngineInterface,
  name: Name,
  request: { body?: string; ms: number; path: string },
): Promise<HttpResponse | undefined> {
  const headers = await headersOf($, name);
  if (headers === undefined) {
    return headers;
  }
  const init =
    request.body === undefined
      ? { headers }
      : {
          body: request.body,
          headers: { ...headers, 'content-type': 'application/json' },
          method: 'POST',
        };
  const fetched = $.http.fetch(`${JUDGES[name].url}${request.path}`, init);
  return await within($, request.ms, fetched).catch(
    async (error: unknown) => await failed($, name, error),
  );
}

/**
One System One request to `name`: its verdict, else the judge marked down from what came back and undefined
*/
async function ask(
  $: EngineInterface,
  name: Name,
  body: { questions: Record<string, unknown>; state: unknown },
): Promise<Verdict | undefined> {
  const { model, timeoutMs } = JUDGES[name];
  const sent = JSON.stringify({ model, questions: body.questions, state: body.state });
  const response = await call($, name, { body: sent, ms: timeoutMs, path: '/systemone' });
  const reply = parsed(response?.text ?? '');
  const markers = response?.ok === true ? answersOf(reply, Object.keys(body.questions)) : undefined;
  if (response === undefined || markers === undefined) {
    const now = await $.clock.now();
    const down =
      response?.ok === false
        ? downOf(response, now)
        : { until: now + DOWN_MS, why: 'no answers in the reply' };
    await (response === undefined ? undefined : mark($, name, down));
    return undefined;
  }
  const tokens = field(field(reply, 'usage'), 'input_tokens');
  await mark($, name, { why: '' });
  return { judge: name, markers, ...(typeof tokens === 'number' && { tokens }) };
}

/**
`ask` when `name` is up or its `until` passed; undefined when it is down
*/
async function attempt(
  $: EngineInterface,
  name: Name,
  body: { questions: Record<string, unknown>; state: unknown },
): Promise<Verdict | undefined> {
  const [held, now] = await Promise.all([read($, gate), $.clock.now()]);
  const { until = 0 } = held[name];
  return until <= now ? await ask($, name, body) : undefined;
}

/**
Asks `questions` (all `noul`) over `state`, TypeSafe first, then Kev: the first judge's verdict, or undefined when no judge answered; both down beforehand is one log line. A judge's failure never rejects
*/
async function judge(
  $: EngineInterface,
  state: unknown,
  questions: Record<string, unknown>,
): Promise<Verdict | undefined> {
  const [held, now] = await Promise.all([read($, gate), $.clock.now()]);
  const { kev, typesafe } = held;
  if ((kev.until ?? 0) > now && (typesafe.until ?? 0) > now) {
    $.ui.log(`subether judge: no judge up (typesafe ${typesafe.why}, kev ${kev.why})`);
    return undefined;
  }
  const body = { questions, state };
  return (await attempt($, 'typesafe', body)) ?? (await attempt($, 'kev', body));
}

/**
One judge's probe: a free `GET /v1/models` within 1 s, its outcome recorded as a real call's would be
*/
async function ping($: EngineInterface, name: Name): Promise<void> {
  const response = await call($, name, { ms: PROBE_MS, path: '/models' });
  const now = await $.clock.now();
  await (response === undefined
    ? undefined
    : mark($, name, response.ok ? { why: '' } : downOf(response, now)));
}

/**
Probes both judges at once, so the first prompt skips one already known down
*/
async function probe($: EngineInterface): Promise<void> {
  await Promise.all([ping($, 'typesafe'), ping($, 'kev')]);
}

export { judge, probe };
