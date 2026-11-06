#!/usr/bin/env bun
// The chart data gate: docs/data/hooks.json, the hook graph's data, against the source it describes — every `on(` call
// in register.tsx (event, matcher, function, file, catch shape), every atom in types/index.d.ts, every read and write a
// listed atom, every function exported by its file. Regexes over the source text; each mismatch is one line, exit 1.
const HOOKS = 'plugins/subether/hooks';

const data: {
  atoms: { file: string | null; name: string }[];
  events: { name: string }[];
  hooks: {
    catch: string;
    effects: { kind: string }[];
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
const [register, types] = await Promise.all([
  Bun.file(`${HOOKS}/register.tsx`).text(),
  Bun.file('plugins/subether/types/index.d.ts').text(),
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
];

if (errors.length > 0) {
  console.log(errors.join('\n'));
  process.exitCode = 1;
}
