// The component catalog: each component's fields, checked before anything is served, and the body it renders
// inside the card every component shares (title, meta, text, options, message box, Send, thread).
import { scaleLinear } from 'd3-scale';
import type { ReactNode } from 'react';

type Option = { hint?: string; label: string; lean?: true; shape?: string; value: string };
type Row = { label: string; value: number };
type Base = {
  id: string;
  meta?: string;
  options?: Option[];
  pick?: 'many' | 'one';
  text?: string;
  title: string;
};
type Display =
  | { component: 'chart'; kind: 'bar' | 'split'; rows: Row[] }
  | { component: 'code'; code: string; html?: string[]; lang?: string }
  | { component: 'figure'; svg: string }
  | { component: 'list'; items: string[] }
  | { component: 'note'; text: string }
  | { component: 'steps'; items: string[]; loop?: true };
type Card = Base &
  (
    | Display
    | { component: 'decision'; options: Option[]; text: string }
    | {
        component: 'teach';
        cost: string;
        html?: string[];
        lang?: string;
        options: Option[];
        pair: [string, string];
        text: string;
      }
  );
/**
a display at the top of the form: a finding he reads, never answers
*/
type Block = Display & { text?: string; title: string };
type Form = { cards: Card[]; overview?: Block[]; text?: string; title: string };
type Of<C extends Card['component']> = Extract<Card, { component: C }>;
type Kind =
  | 'blocks'
  | 'cards'
  | 'id'
  | 'kind'
  | 'lang'
  | 'loop'
  | 'options'
  | 'pair'
  | 'pick'
  | 'rows'
  | 'strings'
  | 'text';

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function listOf(isEach: (item: unknown) => boolean): (value: unknown) => value is unknown[] {
  return (value: unknown): value is unknown[] =>
    Array.isArray(value) && value.length > 0 && value.every((item) => isEach(item));
}
function shapeOf(shape: Record<string, (value: unknown) => boolean>): (value: unknown) => boolean {
  return (value: unknown) =>
    isRecord(value) &&
    Object.keys(value).every((key) => Object.hasOwn(shape, key)) &&
    Object.entries(shape).every(([key, test]) => test(value[key]));
}
const isOptions = listOf(
  shapeOf({
    hint: (hint) => hint === undefined || isText(hint),
    label: isText,
    lean: (lean) => lean === undefined || lean === true,
    shape: (shape) => shape === undefined || isText(shape),
    value: isText,
  }),
);

/**
the language ids `lang` accepts; the server fills it from shiki (lit.ts), so the client bundle carries none
*/
const LANGUAGES = new Set<string>();

/**
what each field kind accepts, as the message says it and as the test checks it
*/
const KINDS: Record<Kind, [string, (value: unknown, owner: Record<string, unknown>) => boolean]> = {
  blocks: ['[block, …]', listOf(() => true)],
  cards: ['[card, …]', listOf(() => true)],
  id: [
    'a letter, then letters, digits, - or _',
    (id) => typeof id === 'string' && /^[a-z][\w-]*$/iu.test(id),
  ],
  kind: ['"bar" or "split"', (kind) => kind === 'bar' || kind === 'split'],
  lang: ['a shiki language id, such as "rust" or "sh"', (lang) => LANGUAGES.has(String(lang))],
  loop: ['true', (loop) => loop === true],
  options: [
    '[{label, value, lean?: true, hint?, shape?}, …], values distinct, exactly one lean unless pick is "many"',
    (options, { pick }) =>
      isOptions(options) &&
      (pick === 'many' || options.filter((option) => (option as Option).lean).length === 1) &&
      options.every(
        (option, index) =>
          options.findIndex((other) => (other as Option).value === (option as Option).value) ===
          index,
      ),
  ],
  pair: [
    '[today, alternative], two strings',
    (pair) => Array.isArray(pair) && pair.length === 2 && pair.every((one) => isText(one)),
  ],
  pick: ['"one" or "many"', (pick) => pick === 'one' || pick === 'many'],
  rows: [
    '[{label, value: a number ≥ 0}, …]',
    listOf(shapeOf({ label: isText, value: (value) => typeof value === 'number' && value >= 0 })),
  ],
  strings: ['[string, …]', listOf(isText)],
  text: ['a non-empty string', isText],
};

/**
each display's own fields, `?` marking the optional; a new one adds its line here and its body below
*/
const DISPLAYS: Record<Display['component'], Record<string, Kind>> = {
  chart: { 'kind': 'kind', 'rows': 'rows', 'text?': 'text' },
  code: { 'code': 'text', 'lang?': 'lang', 'text?': 'text' },
  figure: { 'svg': 'text', 'text?': 'text' },
  list: { 'items': 'strings', 'text?': 'text' },
  note: { text: 'text' },
  steps: { 'items': 'strings', 'loop?': 'loop', 'text?': 'text' },
};
/**
every display with `shared` fields added
*/
function displays(
  shared: Record<string, Kind>,
): Record<Display['component'], Record<string, Kind>> {
  return Object.fromEntries(
    Object.entries(DISPLAYS).map(([name, fields]) => [name, { ...shared, ...fields }]),
  ) as Record<Display['component'], Record<string, Kind>>;
}
const BLOCKS = displays({ title: 'text' });
const COMMON: Record<string, Kind> = {
  'id': 'id',
  'meta?': 'text',
  'pick?': 'pick',
  'title': 'text',
};
/**
each card component's fields: a display's with `options?`, or a component that is always a question
*/
const SCHEMAS: Record<Card['component'], Record<string, Kind>> = {
  ...displays({ ...COMMON, 'options?': 'options' }),
  decision: { ...COMMON, options: 'options', text: 'text' },
  teach: {
    ...COMMON,
    'cost': 'text',
    'lang?': 'lang',
    'options': 'options',
    'pair': 'pair',
    'text': 'text',
  },
};

function check(
  where: string,
  schema: Record<string, Kind>,
  value: Record<string, unknown>,
): string[] {
  return [
    ...Object.entries(schema).flatMap(([key, kind]) => {
      const field = key.replace('?', '');
      const [want, test] = KINDS[kind];
      return (key.endsWith('?') && value[field] === undefined) || test(value[field], value)
        ? []
        : `${where}.${field}: expected ${want}, got ${JSON.stringify(value[field]) ?? 'nothing'}`;
    }),
    ...Object.keys(value)
      .filter(
        (field) =>
          field !== 'component' &&
          !Object.hasOwn(schema, field) &&
          !Object.hasOwn(schema, `${field}?`),
      )
      .map((field) => `${where}.${field}: not a field (${Object.keys(schema).join(', ')})`),
  ];
}

/**
the problems of each entry of `list`, named `<name>[index]` and, for cards (which `seen` dedupes), the id
*/
function entries(list: unknown, name: string, seen?: Set<unknown>): string[] {
  const schemas: Record<string, Record<string, Kind>> = seen ? SCHEMAS : BLOCKS;
  return (Array.isArray(list) ? list : []).flatMap((entry: unknown, index) => {
    const at = `${name}[${index}]`;
    if (!isRecord(entry)) {
      return `${at}: expected an object`;
    }
    const { component, id } = entry;
    const where = seen ? `${at} ${String(id)}` : at;
    const schema = schemas[String(component)];
    const repeat = seen?.has(id) ? [`${where}.id: duplicate`] : [];
    seen?.add(id);
    return schema
      ? [repeat, check(`${where} ${String(component)}`, schema, entry)].flat()
      : `${where}.component: unknown ${JSON.stringify(component)}, the catalog has ${Object.keys(schemas).join(', ')}`;
  });
}

/**
every problem in `form`, each naming the card or overview block and the field; empty when it renders
*/
function validate(form: unknown): string[] {
  if (!isRecord(form)) {
    return ['form: expected {title, cards: [card, …], overview?, text?}'];
  }
  const { cards, overview } = form;
  return [
    ...check(
      'form',
      { 'cards': 'cards', 'overview?': 'blocks', 'text?': 'text', 'title': 'text' },
      form,
    ),
    ...entries(overview, 'overview'),
    ...entries(cards, 'cards', new Set()),
  ];
}

// ─── bodies ──────────────────────────────────────────────────────────────────────────────────────
/**
room a bar leaves for its value label
*/
const LABEL_GUTTER = 48;
/**
the opacity of a split's segments, told apart without colour: white at falling opacity
*/
const OPAQUE = 0.9;
const STRONG = 0.6;
const FAINT = 0.35;
const GHOST = 0.18;
const ROW = 44;
const SHADES = [OPAQUE, STRONG, FAINT, GHOST];
const VALUE_GAP = 6;
const WIDTH = 400;

function Bars({ rows }: Readonly<{ rows: Row[] }>): ReactNode {
  const x = scaleLinear(
    [0, Math.max(...rows.map((row) => row.value)) || 1],
    [0, WIDTH - LABEL_GUTTER],
  );
  return (
    <svg className="chart" role="img" viewBox={`0 0 ${WIDTH} ${rows.length * ROW}`}>
      {rows.map((row, index) => (
        <g key={index} transform={`translate(0 ${index * ROW})`}>
          <text y={14}>{row.label}</text>
          <rect height={16} width={x(row.value)} y={20} />
          <text x={x(row.value) + VALUE_GAP} y={33}>
            {row.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Split({ rows }: Readonly<{ rows: Row[] }>): ReactNode {
  const ends = rows.map((_row, index) =>
    rows.slice(0, index + 1).reduce((sum, row) => sum + row.value, 0),
  );
  const x = scaleLinear([0, ends.at(-1) || 1], [0, WIDTH]);
  return (
    <>
      <svg className="chart" role="img" viewBox={`0 0 ${WIDTH} 28`}>
        {rows.map((row, index) => (
          <rect
            fillOpacity={SHADES[index % SHADES.length]}
            height={28}
            key={index}
            width={x(row.value)}
            x={x((ends[index] ?? 0) - row.value)}
          />
        ))}
      </svg>
      <ul className="legend">
        {rows.map((row, index) => (
          <li key={index}>
            <i style={{ opacity: SHADES[index % SHADES.length] }} />
            {`${row.label} · ${row.value}`}
          </li>
        ))}
      </ul>
    </>
  );
}

function Steps({ items, loop }: Of<'steps'>): ReactNode {
  return (
    <div className="steps">
      <ol>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>
      {loop ? <p className="return">{`↺ back to ${items[0]}`}</p> : undefined}
    </div>
  );
}

/**
a code sample: the server's highlighted markup when it made one, else the plain text
*/
function Sample({ code, html }: Readonly<{ code: string; html?: string | undefined }>): ReactNode {
  return html ? (
    <div className="lit" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

/**
the card's options among `values`, in authored order
*/
function picked(card: Card, values: unknown[]): Option[] {
  return card.options?.filter((option) => values.includes(option.value)) ?? [];
}
/**
what a Send says on the card's hud thread: the picks' labels, each option comment after its label, then the message
*/
function spoken(
  card: Card,
  {
    choices,
    message,
    notes,
  }: { choices: unknown[]; message: string; notes: Record<string, string> },
): string {
  return [
    ...picked(card, choices).map((option) => option.label),
    ...Object.entries(notes).map(([value, text]) => `${picked(card, [value])[0]?.label}: ${text}`),
    message,
  ]
    .filter(Boolean)
    .join(' — ');
}

/**
the part of a card or block only its component draws; decision and note are their text alone
*/
const BODIES: Partial<Record<Card['component'], (card: never) => ReactNode>> = {
  chart: ({ kind, rows }: Of<'chart'>) =>
    kind === 'bar' ? <Bars rows={rows} /> : <Split rows={rows} />,
  code: ({ code, html }: Of<'code'>) => <Sample code={code} html={html?.[0]} />,
  // the author is the local agent, so its markup goes in raw
  figure: ({ svg }: Of<'figure'>) => (
    <div className="figure" dangerouslySetInnerHTML={{ __html: svg }} />
  ),
  list: ({ items }: Of<'list'>) => (
    <ul>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  ),
  steps: Steps,
  teach: ({ cost, html, pair }: Of<'teach'>) => (
    <>
      <div className="pair">
        {pair.map((code, index) => (
          <div key={index}>
            <small>{index ? 'alternative' : 'today'}</small>
            <Sample code={code} html={html?.[index]} />
          </div>
        ))}
      </div>
      <p className="cost">{`Cost: ${cost}`}</p>
    </>
  ),
};

export { BODIES, LANGUAGES, picked, SCHEMAS, spoken, validate };
export type { Block, Card, Form, Option };
