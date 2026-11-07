#!/usr/bin/env bun
// The chart data gate: docs/data/hooks.json, the hook graph's data, against the source it describes — every `on(` call
// in register.tsx (event, matcher, function, file, catch shape), every atom in types/index.d.ts, every read and write a
// listed atom, every function exported by its file; sequence.json's actors a fixed set and its writes hooks.json's
// effects; judge.json's constants, models and endpoints the ones judge.ts and markers.ts declare; the scrubbed samples
// only their allowed keys, since Pages is public. Regexes over the source text; each mismatch is one line, exit 1.
const HOOKS = 'plugins/subether/hooks';

const data: {
  atoms: { file: string | null; name: string }[];
  events: { name: string }[];
  hooks: {
    catch: string;
    effects: { kind: string; target: string }[];
    event: string;
    file: string;
    fn: string | null;
    id: string;
    matcher: unknown;
    reads: string[];
    writes: string[];
  }[];
  kinds: { name: string }[];
} = await Bun.file('docs/data/hooks.json').json();
const [register, types, sequence, judged, calls, trailed] = await Promise.all([
  Bun.file(`${HOOKS}/register.tsx`).text(),
  Bun.file('plugins/subether/types/index.d.ts').text(),
  Bun.file('docs/data/sequence.json').json() as Promise<{
    actors: { name: string }[];
    frames: { first: number; last: number }[];
    messages: { from: string; kind: string; target?: string; to: string }[];
  }>,
  Bun.file('docs/data/judge.json').json() as Promise<{
    constants: Record<string, Record<string, number>>;
    judges: { model: string; name: string; timeout: string; url: string }[];
    states: { doc: string; name: string }[];
    transitions: { from: string; on: string; to: string }[];
  }>,
  Bun.file('docs/data/sample-calls.json').json() as Promise<Record<string, unknown>[]>,
  Bun.file('docs/data/sample-markers.json').json() as Promise<Record<string, unknown>[]>,
]);
const glob = new Bun.Glob('*.{ts,tsx}');
const sources = new Map(
  await Promise.all(
    [...glob.scanSync(HOOKS)].map(async (file): Promise<[string, string]> => [
      file,
      await Bun.file(`${HOOKS}/${file}`).text(),
    ]),
  ),
);

/**
A JSON value with its object keys sorted, so two spellings of one matcher compare equal
*/
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).toSorted(([one], [other]) => one.localeCompare(other)),
        )
      : item,
  );

/**
Each imported name's file
*/
const imports = new Map(
  register
    .matchAll(/import \{(?<names>[^}]*)\} from '\.\/(?<stem>\w+)'/gu)
    .flatMap(({ groups: { names = '', stem = '' } = {} }) => {
      const file = sources.has(`${stem}.ts`) ? `${stem}.ts` : `${stem}.tsx`;
      return names.split(',').map((name): [string, string] => [name.trim(), file]);
    }),
);

/**
A `.catch(` handler's shape: none, `async …` passing on, or a named handler denying
*/
const shapeOf = (handler: string | undefined): string => {
  if (handler === undefined) {
    return 'none';
  }
  return handler === 'async' ? 'pass' : 'deny';
};

/**
One `on(` statement's key: event, matcher, file, function, catch shape; an inline stub is register.tsx's, no function
*/
const wired = register
  .replaceAll(/^\s*\/\/.*$/gmu, '')
  .matchAll(/^\s*on\(\s*'(?<event>[^']+)',\s*(?<rest>[^]*?)\);$/gmu)
  .map(({ groups: { event = '', rest = '' } = {} }) => {
    const literal = /^\{[^]*?\}(?=,)/u.exec(rest)?.[0];
    const json = literal?.replaceAll("'", '"').replaceAll(/(?<key>\w+)\s*:/gu, '"$<key>":');
    const { name } = /^(?:\{[^]*?\},\s*)?(?!async\b)(?<name>\w+)/u.exec(rest)?.groups ?? {};
    const { handler } = /\.catch\(\s*(?<handler>\w+)/u.exec(rest)?.groups ?? {};
    const shape = shapeOf(handler);
    return canon([
      event,
      json === undefined ? '' : JSON.parse(json),
      name === undefined ? 'register.tsx' : imports.get(name),
      name ?? '',
      shape,
    ]);
  })
  .toArray();
const listed = data.hooks.map((hook) =>
  canon([hook.event, hook.matcher ?? '', hook.file, hook.fn ?? '', hook.catch]),
);

const { body = '' } = /subether: \{(?<body>[^]*?)\n {4}\};/u.exec(types)?.groups ?? {};
const declared = body
  .matchAll(/^\s+(?<name>\w+)\??:/gmu)
  .map(({ groups: { name = '' } = {} }) => name)
  .toArray();
/**
Whether `file` exports `name`
*/
const doesExport = (file: string, name: string): boolean => {
  const exported = new RegExp(`export \\{[^}]*\\b${name}\\b`, 'u');
  return exported.test(sources.get(file) ?? '');
};
const atoms = new Set(data.atoms.map((atom) => atom.name));
const events = new Set(data.events.map((event) => event.name));
const kinds = new Set(data.kinds.map((kind) => kind.name));
const ids = new Set(data.hooks.map((hook) => hook.id));

/**
the fixed lifelines and message kinds of sequence.json, and the effect targets a write may name
*/
const LIFELINES = new Set(['engine', 'guard', 'judge', 'log', 'model', 'tool', 'tool.check']);
const MESSAGE_KINDS = new Set(['call', 'deny', 'return', 'write']);
const sinks = new Set(data.hooks.flatMap((hook) => hook.effects.map(({ target }) => target)));
const actors = new Set(sequence.actors.map(({ name }) => name));
const messages = sequence.messages.map((message, index) => ({
  ...message,
  at: `sequence #${index}`,
}));

/**
judge.json's constants by name, judge.ts's text, and the listed states
*/
const constants = new Map(
  Object.entries(judged.constants).flatMap(([file, values]) =>
    Object.entries(values).map(([name, value]): [string, { file: string; value: number }] => [
      name,
      { file, value },
    ]),
  ),
);
const judgeSource = sources.get('judge.ts') ?? '';
const states = new Set(judged.states.map(({ name }) => name));
/**
A constant's `const NAME = n` in its file, underscores dropped; undefined when the file declares none
*/
const declaredValue = (file: string, name: string): number | undefined => {
  const pattern = new RegExp(`^const ${name} = (?<value>[\\d_.]+);$`, 'mu');
  const { value } = pattern.exec(sources.get(file) ?? '')?.groups ?? {};
  return value === undefined ? undefined : Number(value.replaceAll('_', ''));
};

/**
the scrubbed samples' rows, each value checked: Pages is public, so a key or a string outside these never ships
*/
type Shape = Record<string, (value: unknown) => boolean>;
const HOURS = 24;
const TOOL = /^(?:mcp|[A-Z][A-Za-z]+)$/u;
const isCount = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
const isHour = (value: unknown): boolean => isCount(value) && Number(value) < HOURS;
const isP = (value: unknown): boolean => typeof value === 'number' && value >= 0 && value <= 1;
const isTool = (value: unknown): boolean => TOOL.test(String(value));
const oneOf =
  (...allowed: unknown[]) =>
  (value: unknown): boolean =>
    allowed.includes(value);
const CALL_ROW: Record<string, Shape> = {
  call: {
    chars: isCount,
    hour: isHour,
    kind: oneOf('call'),
    ms: isCount,
    outcome: oneOf('denied', 'error', 'ok'),
    readOnly: oneOf(false, true),
    tool: isTool,
  },
  check: {
    decision: oneOf('allow', 'ask', 'deny'),
    destructive: isP,
    hour: isHour,
    kind: oneOf('check'),
    ms: isCount,
    outbound: isP,
    routine: isP,
    secrets: isP,
    tool: isTool,
  },
};
/**
JSON's null: the samples' empty judge and p
*/
const isNull = (value: unknown): boolean => typeof value === 'object' && !value;
const MARKER_ROW: Record<string, Shape> = {
  marker: Object.fromEntries([
    ['day', (value: unknown): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(String(value))],
    ['hour', isHour],
    ['judge', (value: unknown): boolean => isNull(value) || oneOf('kev', 'typesafe')(value)],
    ['marker', oneOf('approval', 'correction', 'preference', 'regex', 'repeated instruction')],
    ['p', (value: unknown): boolean => isNull(value) || isP(value)],
  ]),
};
/**
Each row's keys exactly its kind's (a row with no `kind` is a marker row), each value passing its check
*/
const sampleErrors = (
  file: string,
  rows: Record<string, unknown>[],
  shapes: Record<string, Shape>,
): string[] =>
  rows.flatMap((row, index) => {
    const { kind = 'marker' } = row;
    const shape = shapes[String(kind)];
    if (shape === undefined) {
      return `${file} #${index}: kind ${String(kind)} is unknown`;
    }
    const keys = Object.keys(row)
      .toSorted((one, other) => one.localeCompare(other))
      .join(',');
    const allowed = Object.keys(shape).join(',');
    if (keys !== allowed) {
      return `${file} #${index}: keys ${keys}, allowed ${allowed}`;
    }
    return Object.entries(shape)
      .filter(([key, isValid]) => !isValid(row[key]))
      .map(([key]) => `${file} #${index}: ${key} ${JSON.stringify(row[key])} is not allowed`);
  });

const errors = [
  ...wired
    .filter((key) => !listed.includes(key))
    .map((key) => `register.tsx wires ${key}, hooks.json does not`),
  ...listed
    .filter((key) => !wired.includes(key))
    .map((key) => `hooks.json lists ${key}, register.tsx does not wire it`),
  ...declared
    .filter((name) => !atoms.has(name))
    .map((name) => `atom ${name} is declared, not listed`),
  ...[...atoms]
    .filter((name) => !declared.includes(name))
    .map((name) => `atom ${name} is listed, not declared`),
  ...[...events]
    .filter((name) => data.hooks.every((hook) => hook.event !== name))
    .map((name) => `event ${name} has no hook`),
  ...data.atoms
    .filter(
      ({ file, name }) =>
        typeof file === 'string' && sources.get(file)?.includes(`atom({ key: '${name}'`) !== true,
    )
    .map(({ file, name }) => `atom ${name}: ${file ?? ''} declares no atom`),
  ...data.hooks.flatMap((hook) => [
    ...(events.has(hook.event) ? [] : [`${hook.id}: event ${hook.event} is not listed`]),
    ...[...hook.reads, ...hook.writes]
      .filter((name) => !atoms.has(name))
      .map((name) => `${hook.id}: ${name} is no listed atom`),
    ...hook.effects
      .filter(({ kind }) => !kinds.has(kind))
      .map(({ kind }) => `${hook.id}: effect kind ${kind} is not listed`),
    ...(typeof hook.fn !== 'string' || doesExport(hook.file, hook.fn)
      ? []
      : [`${hook.id}: ${hook.file} does not export ${hook.fn}`]),
  ]),
  ...(ids.size === data.hooks.length ? [] : ['hook ids repeat']),
  ...[...actors]
    .filter((name) => !LIFELINES.has(name))
    .map((name) => `sequence: actor ${name} is no lifeline`),
  ...messages.flatMap(({ at, from, to }) =>
    [from, to].filter((name) => !actors.has(name)).map((name) => `${at}: ${name} is no actor`),
  ),
  ...messages
    .filter(({ kind }) => !MESSAGE_KINDS.has(kind))
    .map(({ at, kind }) => `${at}: kind ${kind} is unknown`),
  ...messages
    .filter(({ kind, target }) => kind === 'write' && !sinks.has(target ?? ''))
    .map(({ at, target }) => `${at}: write target ${target ?? '—'} is no hooks.json effect`),
  ...sequence.frames
    .filter(({ first, last }) => first < 0 || first > last || last >= messages.length)
    .map(({ first, last }) => `sequence: frame ${first}–${last} is outside the messages`),
  ...[...constants]
    .filter(([name, { file, value }]) => declaredValue(file, name) !== value)
    .map(
      ([name, { file, value }]) =>
        `judge.json: ${name} = ${value}, ${file} declares ${declaredValue(file, name) ?? 'none'}`,
    ),
  ...judged.judges
    .filter(
      ({ model, name, timeout, url }) =>
        !judgeSource.includes(
          `${name}: { model: '${model}', timeoutMs: ${timeout}, url: '${url}' }`,
        ),
    )
    .map(({ name }) => `judge.json: judge ${name} is not judge.ts's JUDGES.${name}`),
  ...[...judged.states.map(({ doc }) => doc), ...judged.transitions.map(({ on }) => on)]
    .flatMap((text) =>
      text
        .matchAll(/\{(?<name>\w+)\}/gu)
        .map(({ groups: { name = '' } = {} }) => name)
        .toArray(),
    )
    .filter((name) => !constants.has(name))
    .map((name) => `judge.json: {${name}} is no listed constant`),
  ...judged.transitions
    .flatMap(({ from, to }) => [from, to])
    .filter((name) => !states.has(name))
    .map((name) => `judge.json: state ${name} is not listed`),
  ...sampleErrors('sample-calls.json', calls, CALL_ROW),
  ...sampleErrors('sample-markers.json', trailed, MARKER_ROW),
];

if (errors.length > 0) {
  console.log(errors.join('\n'));
  process.exitCode = 1;
}
