/**
The census feed's senses survey, run by `bun senses/cli.ts`: every event the engine's types offer, its own and the classic
hooks', with its top-level input fields, and the calls on `$` by name, set against what census.ts reads, as
`hooks/senses.ts` records it. Bare, it prints the drift, a `+` or `-` line per fact gained or lost and a `!` line per
field census reads that none of its hook's events offers, exit 1 on any; `--write` rewrites the manifest from the survey
and still fails on a `!`
*/
import {
  type Node,
  isArrowFunction,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isModuleDeclaration,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
} from 'tsrs/ast';
import { API, type Checker, type Program } from 'tsrs/async';
import { type Infer, type Schema, coerce, list, object, parse, record, string } from 'verax';

const strings = list(string());

/**
`schema`, `empty` where the key is absent: a mod not yet surveyed records `undeclared` alone
*/
const or = <TSchema extends Schema>(
  schema: TSchema,
  empty: Infer<TSchema>,
): Schema<Infer<TSchema>, unknown> => coerce(schema, (value) => value ?? empty);

const fieldsRead = object('fields', { read: strings, unread: strings });

/**
What `hooks/senses.ts` records: the events census hooks, each field read or not; the others, by field; the events whose
input carries a tool's arguments beside the fields named; the calls on `$`; the fields a namespace's events carry at run
time that the types do not declare, by `<namespace>.*`, reviewed by hand and kept by every `--write`; the engine version
it was surveyed at
*/
const MANIFEST = object('manifest', {
  args: or(strings, []),
  events: or(record(fieldsRead), {}),
  ops: or(strings, []),
  undeclared: record(strings),
  unsubscribed: or(record(strings), {}),
  version: or(string(), ''),
});
type Manifest = Infer<typeof MANIFEST>;

/**
the manifest `path` exports, read fresh past the module cache
*/
const manifestOf = async (path: string): Promise<Manifest> =>
  parse(
    // a module namespace is no plain object: its exports, copied, are
    { ...(await import(`${path}?${crypto.randomUUID()}`)) },
    object('senses.ts', { senses: MANIFEST }),
  ).senses;

/**
the mod's folder
*/
const HOME = `${import.meta.dir}/../`;

const sorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].toSorted((left, right) => left.localeCompare(right));

const descend = (node: Node): Node[] => [
  node,
  ...node.getChildren().flatMap((child) => descend(child)),
];

/**
`work` on a tsrs session rooted at `cwd`, closed once it settled
*/
const session = async <T>(cwd: string, work: (api: API) => Promise<T>): Promise<T> => {
  const api = new API({ cwd });
  const result = await work(api);
  await api.close();
  return result;
};

/**
One symbol of the checker's
*/
type Named = Parameters<Checker['getDeclaredTypeOfSymbol']>[0];

/**
The properties of the type `symbol` declares: an event table's events
*/
const table = async (checker: Checker, symbol: Named | undefined): Promise<readonly Named[]> =>
  symbol === undefined
    ? []
    : checker.getPropertiesOfType(await checker.getDeclaredTypeOfSymbol(symbol));

/**
An event's fields, every variant's or, for one open to a tool's arguments (an index signature in a variant), the
envelope all its variants share
*/
const fieldsOf = async (
  checker: Checker,
  event: Named,
): Promise<[string, { fields: string[]; open: boolean }]> => {
  const type = await checker.getTypeOfSymbol(event);
  const variants = type.isUnionType() ? ((await type.getTypes()) ?? []) : [type];
  const infos = await Promise.all(variants.map(async (each) => checker.getIndexInfosOfType(each)));
  const open = infos.some((each) => each.length > 0);
  const properties = await Promise.all(
    variants.map(async (each) => checker.getPropertiesOfType(each)),
  );
  const names = properties.map((each) => each.map((property) => property.name));
  const fields = names.flat().filter((key) => !open || names.every((each) => each.includes(key)));
  return [event.name, { fields: sorted(fields), open }];
};

/**
The checker over every engine-written type root under `types`, and the `claude-code` one's file
*/
const load = async (
  api: API,
  types: string,
): Promise<{ checker: Checker; file: Awaited<ReturnType<Program['getSourceFile']>> }> => {
  const glob = new Bun.Glob('*/index.d.ts');
  const rootFiles = [...glob.scanSync(types)].map((path) => `${types}/${path}`);
  const compilerOptions = { lib: ['lib.es2023.d.ts'], noEmit: true, types: [] };
  const { operation } = await api.createSnapshot({
    createPrograms: [{ compilerOptions, rootFiles }],
  });
  const [program] = operation.createdPrograms;
  const file = await program.getSourceFile(`${types}/claude-code/index.d.ts`);
  return { checker: program.getProject().checker, file };
};

/**
The offered surface from the engine-written types under `types`: each event's fields, the `$` calls, the version line 1
names
*/
const offer = async (
  types: string,
): Promise<{
  events: Record<string, { fields: string[]; open: boolean }>;
  ops: string[];
  version: string;
}> =>
  session(types, async (api) => {
    const { checker, file } = await load(api, types);
    const module = file?.statements
      .filter((statement) => isModuleDeclaration(statement))
      .find((statement) => statement.name.text === 'claude-code');
    const exports =
      module === undefined
        ? []
        : await checker.getExportsOfModule(await checker.getSymbolOfDeclaration(module));
    const named = (name: string): Named | undefined => exports.find((each) => each.name === name);
    const [classic, engine, ops] = await Promise.all(
      ['ClassicEventOf', 'EngineEventOf', 'OpEventOf'].map(async (name) =>
        table(checker, named(name)),
      ),
    );
    const events = await Promise.all(
      [classic ?? [], engine ?? []].flat().map(async (event) => fieldsOf(checker, event)),
    );
    return {
      events: Object.fromEntries(events),
      ops: sorted((ops ?? []).map((op) => op.name)),
      version: /(?<=Claude Code )\S+(?=\.$)/mu.exec(file?.text ?? '')?.[0] ?? '',
    };
  });

/**
What one hook reads of `e`, its second parameter: `e.x`, `field(e, 'x')` and `const { x } = e`
*/
const readsOf = (hook: Node & { body: Node; parameters: readonly { name: Node }[] }): string[] => {
  const e = hook.parameters[1]?.name.getText();
  return descend(hook.body).flatMap((id) => {
    const { parent } = id;
    if (!isIdentifier(id) || id.text !== e) {
      return [];
    }
    if (isPropertyAccessExpression(parent) && parent.expression === id) {
      return [parent.name.getText()];
    }
    const [, key] =
      isCallExpression(parent) && parent.expression.getText() === 'field' ? parent.arguments : [];
    if (key && isStringLiteral(key)) {
      return [key.text];
    }
    return isVariableDeclaration(parent) && isObjectBindingPattern(parent.name)
      ? parent.name.elements.map(
          (element) => (element.propertyName ?? element.name)?.getText() ?? '',
        )
      : [];
  });
};

/**
Each census.ts hook `register.tsx` binds, by name: the events it is bound to and what it reads of them
*/
const reads = async (
  hooks: string,
): Promise<Record<string, { events: string[]; fields: string[] }>> =>
  session(hooks, async (api) => {
    const nodesOf = async (name: string): Promise<Node[]> => {
      const path = `${hooks}/${name}`;
      const retained = await api.createSourceFile(path, await Bun.file(path).text());
      return descend(retained.sourceFile);
    };
    const [register, census] = await Promise.all([nodesOf('register.tsx'), nodesOf('census.ts')]);
    const bound = register.flatMap((node) =>
      isCallExpression(node) && node.expression.getText() === 'on'
        ? [[node.arguments[0], node.arguments.at(-1)].map((argument) => argument?.getText() ?? '')]
        : [],
    );
    return Object.fromEntries(
      census
        .filter((node) => isVariableDeclaration(node))
        .flatMap(({ initializer: hook, name }) => {
          const events = bound
            .filter(([, each]) => each === name.getText())
            .map(([event = '']) => event.replaceAll("'", ''));
          return hook !== undefined &&
            (isArrowFunction(hook) || isFunctionExpression(hook)) &&
            events.length > 0
            ? [[name.getText(), { events, fields: sorted(readsOf(hook)) }] as const]
            : [];
        }),
    );
  });

/**
The manifest the surface, the reads and the reviewed undeclared fields make, and a `!` line for each read none of its
hook's events offers
*/
const survey = (
  offered: Awaited<ReturnType<typeof offer>>,
  hooks: Awaited<ReturnType<typeof reads>>,
  undeclared: Manifest['undeclared'],
): { ghosts: string[]; manifest: Manifest } => {
  const read = new Map<string, string[]>();
  for (const { events, fields } of Object.values(hooks)) {
    for (const event of events) {
      read.set(event, [...(read.get(event) ?? []), ...fields]);
    }
  }
  const entries = Object.entries(offered.events).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  const heard = entries.filter(([event]) => read.has(event));
  return {
    ghosts: Object.entries(hooks).flatMap(([hook, { events, fields }]) =>
      fields
        .filter((field) =>
          events.every((event) => offered.events[event]?.fields.includes(field) !== true),
        )
        .map(
          (field) => `! census's ${hook} reads ${field}, which none of ${events.join(', ')} offers`,
        ),
    ),
    manifest: {
      args: entries.filter(([, { open }]) => open).map(([event]) => event),
      events: Object.fromEntries(
        heard.map(([event, { fields }]) => [
          event,
          {
            read: fields.filter((field) => read.get(event)?.includes(field) === true),
            unread: fields.filter((field) => read.get(event)?.includes(field) !== true),
          },
        ]),
      ),
      ops: offered.ops,
      undeclared,
      unsubscribed: Object.fromEntries(
        entries.filter(([event]) => !read.has(event)).map(([event, { fields }]) => [event, fields]),
      ),
      version: offered.version,
    },
  };
};

/**
A manifest as facts, one string apiece, so two compare as sets
*/
const facts = (manifest: Manifest): Set<string> =>
  new Set([
    `version ${manifest.version}`,
    ...manifest.args.map((event) => `args ${event}`),
    ...manifest.ops.map((op) => `op ${op}`),
    ...Object.entries(manifest.events).flatMap(([event, { read, unread }]) =>
      [
        `event ${event}`,
        `subscribed ${event}`,
        read.map((field) => `read ${event} ${field}`),
        [read, unread].flat().map((field) => `field ${event} ${field}`),
      ].flat(),
    ),
    ...Object.entries(manifest.unsubscribed).flatMap(([event, fields]) =>
      [`event ${event}`, fields.map((field) => `field ${event} ${field}`)].flat(),
    ),
  ]);

/**
What `now` gained over `was` (`+`) and lost (`-`)
*/
const drift = (was: Manifest, now: Manifest): string[] => {
  const [before, after] = [facts(was), facts(now)];
  return [
    ...[...after].filter((fact) => !before.has(fact)).map((fact) => `+ ${fact}`),
    ...[...before].filter((fact) => !after.has(fact)).map((fact) => `- ${fact}`),
  ];
};

/**
The survey of the mod at `home` against its manifest, the drift printed, or with `--write` the manifest rewritten and
formatted; 1 on any line printed
*/
const main = async (argv: string[], home = HOME): Promise<number> => {
  const path = `${home}hooks/senses.ts`;
  const senses = await manifestOf(path);
  const { ghosts, manifest } = survey(
    await offer(`${home}.claude-plugin/types`),
    await reads(`${home}hooks`),
    senses.undeclared,
  );
  const isWrite = argv.includes('--write');
  if (isWrite) {
    await Bun.write(
      path,
      `/**\nThe census feed's senses, written by \`bun senses/cli.ts --write\` but \`undeclared\`, reviewed by hand and kept\n*/\nexport const senses = ${JSON.stringify(manifest)};\n`,
    );
    Bun.spawnSync(['bun', 'fmt', path], { cwd: home });
  }
  const lines = [...(isWrite ? [] : drift(senses, manifest)), ...ghosts];
  process.stdout.write(lines.map((line) => `${line}\n`).join(''));
  return lines.length > 0 ? 1 : 0;
};

export { drift, main, manifestOf, offer, reads, survey };
