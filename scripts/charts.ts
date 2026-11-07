#!/usr/bin/env bun
// The chart data gate: docs/data/hooks.json, the hook graph's data, against the source it describes — every `on(` call
// in register.tsx (event, matcher, function, file, catch shape), every atom in types/index.d.ts, every read and write a
// listed atom, every function exported by its file; call.json a well-formed state machine, its owners a fixed set and
// each write one of its hook's effects; judge.json's constants, models and endpoints the ones judge.ts and markers.ts
// declare; session.json's moments in order, each on a listed event and its hook's, writing that hook's effects, its
// markers the QUESTIONS of the hook's file, judged by a listed judge, and one trail event per marker at THRESHOLD or
// over, worded as markers.ts words it; the scrubbed samples only their allowed keys, since Pages is public. Regexes over
// the source text; each mismatch is one line, exit 1.
const HOOKS = 'plugins/subether/hooks';
type Write = { hook: string; target: string };

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
    status: string;
    writes: string[];
  }[];
  kinds: { name: string }[];
} = await Bun.file('docs/data/hooks.json').json();
const [register, types, machine, judged, calls, trailed, session] = await Promise.all([
  Bun.file(`${HOOKS}/register.tsx`).text(),
  Bun.file('plugins/subether/types/index.d.ts').text(),
  Bun.file('docs/data/call.json').json() as Promise<{
    owners: { name: string }[];
    states: {
      col: number;
      initial?: boolean;
      name: string;
      owner: string;
      row: number;
      terminal?: boolean;
      writes?: Write[];
    }[];
    transitions: { from: string; to: string; writes?: Write[] }[];
  }>,
  Bun.file('docs/data/judge.json').json() as Promise<{
    constants: Record<string, Record<string, number>>;
    judges: { model: string; name: string; timeout: string; url: string }[];
    states: { doc: string; name: string }[];
    transitions: { from: string; on: string; to: string }[];
  }>,
  Bun.file('docs/data/sample-calls.json').json() as Promise<Record<string, unknown>[]>,
  Bun.file('docs/data/sample-markers.json').json() as Promise<Record<string, unknown>[]>,
  Bun.file('docs/data/session.json').json() as Promise<{
    lanes: { name: string }[];
    moments: {
      at: number;
      effects: { target: string }[];
      event: string;
      hook: string;
      judge?: { by: string; markers: Record<string, number> };
      label: string;
      status?: string;
      trails?: { kind: string; rationale: string }[];
    }[];
  }>,
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
call.json's fixed owners, its states by name, the states reachable from the initial one, and its writes
*/
const OWNERS = new Set(['check', 'engine', 'guard', 'judge', 'tool']);
const owners = new Set(machine.owners.map(({ name }) => name));
const stateNames = new Set(machine.states.map(({ name }) => name));
const initials = machine.states.filter(({ initial }) => initial === true);
/**
`names` and every state a transition out of one of them reaches, to the fixed point
*/
const reach = (names: Set<string>): Set<string> => {
  const next = names.union(
    new Set(machine.transitions.filter(({ from }) => names.has(from)).map(({ to }) => to)),
  );
  return next.size === names.size ? names : reach(next);
};
const reached = reach(new Set(initials.map(({ name }) => name)));
const cells = new Set(machine.states.map(({ col, row }) => `${col},${row}`));
const machineWrites = [
  ...machine.states.flatMap(({ name, writes = [] }) =>
    writes.map((write) => ({ ...write, at: `call: ${name}` })),
  ),
  ...machine.transitions.flatMap(({ from, to, writes = [] }) =>
    writes.map((write) => ({ ...write, at: `call: ${from} → ${to}` })),
  ),
];
const effectsOf = new Map(
  data.hooks.map((hook) => [hook.id, new Set(hook.effects.map(({ target }) => target))]),
);

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
session.json's fixed lanes and trail kinds, the threshold, each hook by id, the trail prefixes markers.ts writes
*/
const LANES = new Set(['event', 'hook', 'judge', 'trail']);
const TRAIL_KINDS = new Set(['correction', 'guard']);
const threshold = constants.get('THRESHOLD')?.value ?? 1;
const hookById = new Map(data.hooks.map((hook) => [hook.id, hook]));
const judgeNames = new Set(judged.judges.map(({ name }) => name));
const { prefixes = '' } =
  /const PREFIX[^=]*= \{(?<prefixes>[^}]*)\}/u.exec(sources.get('markers.ts') ?? '')?.groups ?? {};
const PREFIX = new Map(
  prefixes
    .matchAll(/(?<name>\w+): '(?<prefix>[^']*)'/gu)
    .map(({ groups: { name = '', prefix = '' } = {} }): [string, string] => [name, prefix]),
);
/**
The top-level keys of a file's `const QUESTIONS = {` block, sorted and joined
*/
const questionsOf = (file: string): string => {
  const { block = '' } =
    /^const QUESTIONS = \{(?<block>[^]*?)^\};$/mu.exec(sources.get(file) ?? '')?.groups ?? {};
  return block
    .matchAll(/^ {2}(?<name>\w+): \{/gmu)
    .map(({ groups: { name = '' } = {} }) => name)
    .toArray()
    .toSorted((one, other) => one.localeCompare(other))
    .join(',');
};
/**
One moment's mismatches: its event, hook, effects, stub status, judge and trails against the hook graph and the source
*/
const momentErrors = (moment: (typeof session.moments)[number], index: number): string[] => {
  const at = `session #${index} (${moment.label})`;
  const hook = hookById.get(moment.hook);
  if (hook === undefined) {
    return [`${at}: hook ${moment.hook} is not listed`];
  }
  const { by = '', markers = {} } = moment.judge ?? {};
  const trails = moment.trails ?? [];
  const keys = Object.keys(markers)
    .toSorted((one, other) => one.localeCompare(other))
    .join(',');
  const over = Object.entries(markers).filter(([, odds]) => odds >= threshold);
  const isWorded = (name: string, odds: number): boolean =>
    trails.some(
      ({ rationale }) =>
        rationale.startsWith(PREFIX.get(name) ?? '\0') &&
        rationale.endsWith(` (p=${odds.toFixed(2)}, ${by})`),
    );
  return [
    ...(events.has(moment.event) ? [] : [`${at}: event ${moment.event} is not listed`]),
    ...(hook.event === moment.event
      ? []
      : [`${at}: ${hook.id} is on ${hook.event}, not ${moment.event}`]),
    ...moment.effects
      .filter(({ target }) => effectsOf.get(hook.id)?.has(target) !== true)
      .map(({ target }) => `${at}: write ${target} is no effect of hook ${hook.id}`),
    ...((moment.status === 'stub') === (hook.status === 'stub')
      ? []
      : [`${at}: stub status differs from ${hook.id}'s`]),
    ...(moment.judge === undefined || keys === questionsOf(hook.file)
      ? []
      : [`${at}: markers ${keys}, ${hook.file} asks ${questionsOf(hook.file)}`]),
    ...(moment.judge === undefined || judgeNames.has(by)
      ? []
      : [`${at}: judge ${by} is not listed`]),
    ...(hook.id !== 'markers.markers' || trails.length === over.length
      ? []
      : [`${at}: ${trails.length} trails, ${over.length} markers at ${threshold} or over`]),
    ...(hook.id === 'markers.markers' ? over : [])
      .filter(([name, odds]) => !isWorded(name, odds))
      .map(([name]) => `${at}: no trail worded as markers.ts words ${name}`),
    ...trails
      .filter(
        ({ kind }) => !TRAIL_KINDS.has(kind) || (hook.id.startsWith('guard.') && kind !== 'guard'),
      )
      .map(({ kind }) => `${at}: trail kind ${kind} is not allowed here`),
  ];
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
  ...[...owners]
    .filter((name) => !OWNERS.has(name))
    .map((name) => `call: owner ${name} is not one of ${[...OWNERS].join(', ')}`),
  ...machine.states
    .filter(({ owner }) => !owners.has(owner))
    .map(({ name, owner }) => `call: ${name}'s owner ${owner} is not listed`),
  ...(stateNames.size === machine.states.length ? [] : ['call: state names repeat']),
  ...(initials.length === 1 ? [] : [`call: ${initials.length} initial states, not one`]),
  ...machine.transitions
    .flatMap(({ from, to }) => [from, to])
    .filter((name) => !stateNames.has(name))
    .map((name) => `call: transition state ${name} is not listed`),
  ...machine.states
    .filter(
      ({ name, terminal = false }) =>
        terminal === machine.transitions.some(({ from }) => from === name),
    )
    .map(({ name, terminal = false }) =>
      terminal
        ? `call: terminal ${name} has a way out`
        : `call: ${name} has no way out, not terminal`,
    ),
  ...machine.states
    .filter(({ name }) => !reached.has(name))
    .map(({ name }) => `call: ${name} is unreachable from the initial state`),
  ...machineWrites
    .filter(({ hook, target }) => effectsOf.get(hook)?.has(target) !== true)
    .map(({ at, hook, target }) => `${at}: write ${target} is no effect of hook ${hook}`),
  ...(cells.size === machine.states.length ? [] : ['call: two states share a grid cell']),
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
  ...session.lanes
    .filter(({ name }) => !LANES.has(name))
    .map(({ name }) => `session: lane ${name} is not one of ${[...LANES].join(', ')}`),
  ...session.moments
    .filter(({ at }, index) => index > 0 && at < (session.moments[index - 1]?.at ?? 0))
    .map(({ label }) => `session: ${label} is out of order`),
  ...session.moments.flatMap(momentErrors),
  ...sampleErrors('sample-calls.json', calls, CALL_ROW),
  ...sampleErrors('sample-markers.json', trailed, MARKER_ROW),
];

if (errors.length > 0) {
  console.log(errors.join('\n'));
  process.exitCode = 1;
}
