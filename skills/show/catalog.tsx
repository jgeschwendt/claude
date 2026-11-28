// The component catalog: the plan's contract as verax tuples, checked before anything is served, and the body each
// context renders in the overview or in a question's body, the composition every question holds (title, body with its
// choices, message box, Ask, thread).
import { scaleLinear } from 'd3-scale';
import { type ReactNode, useState } from 'react';
import {
  type Infer,
  type ObjectOf,
  type Schema,
  type Shape,
  unknown as anything,
  enums,
  float,
  validate as judge,
  list,
  literal,
  object,
  optional,
  record,
  refine,
  string,
  tuple,
  union,
} from 'verax';

/**
the language ids `lang` accepts; the server fills it from shiki (lit.ts), so the client bundle carries none
*/
const LANGUAGES = new Set<string>();

/**
what xstate says of a machine part that passed its field checks, each problem as `field: message`; the server
installs it (machine.ts), so the client bundle carries no xstate
*/
const MACHINE: { problems?: (props: MachineProps) => string[] } = {};

// ─── schemas ─────────────────────────────────────────────────────────────────────────────────────
/**
a list of at least one
*/
function some<T extends Schema>(of: T): Schema<Infer<T>[]> {
  return refine(list(of), 'Expected at least one', (items) => items.length > 0);
}
/**
whether every value of `values` is its own
*/
function isDistinct(values: unknown[]): boolean {
  const seen = new Set(values);
  return seen.size === values.length;
}
/**
a record of at least one, its keys all passing `isFit`
*/
function keyed<T extends Schema>(
  of: T,
  message: string,
  isFit: (key: string) => boolean,
): Schema<Record<string, Infer<T>>> {
  return refine(
    record(of),
    message,
    (all) => Object.keys(all).length > 0 && Object.keys(all).every((key) => isFit(key)),
  );
}

const words = refine(string(), 'Expected a non-empty string', (value) => value.trim() !== '');
const maybe = optional(words);
const once = optional(literal(true));
/**
a language id of shiki's
*/
const language = refine(string(), 'Expected a shiki language id, such as "rust" or "sh"', (id) =>
  LANGUAGES.has(id),
);
const lang = optional(language);
const row = tuple([words, refine(float(), 'Expected a number ≥ 0', (value) => value >= 0)]);
const optionShape = object('option', { hint: maybe, label: words, lean: once, shape: maybe });
/**
a code tab: its label and sample, then its language when it has one (a tuple has no optional item)
*/
const tab = union('tab', [tuple([words, words]), tuple([words, words, words])]);
/**
an id, a letter first: never a whole number, which JS would hoist ahead of its record's other keys
*/
const NAME = /^[a-z][\w-]*$/iu;
const id = refine(string(), 'Expected a letter, then letters, digits, - or _', (name) =>
  NAME.test(name),
);
const heading = { title: maybe };
/**
a part's props: its own fields, and a heading
*/
function props<F extends Shape>(
  name: string,
  fields: F,
): Schema<ObjectOf<F & typeof heading>, ObjectOf<F & typeof heading, 'input'>> {
  return object(name, { ...fields, ...heading });
}
/**
a tabs context's tabs: two at least, their labels distinct and their languages shiki's
*/
const tabs = refine(
  refine(
    some(tab),
    'Expected at least two tabs with distinct labels',
    (all) => all.length > 1 && isDistinct(all.map((each) => each[0])),
  ),
  'Expected each tab language a shiki language id, such as "rust" or "sh"',
  (all) => all.every((each) => each.slice(2).every((tag) => LANGUAGES.has(tag))),
);
const machineProps = refine(
  props('machine', {
    loop: once,
    machine: union('machine', [record(anything()), some(words)]),
    walk: optional(some(words)),
  }),
  'Expected loop only with a list of steps',
  (entry) => entry.loop === undefined || Array.isArray(entry.machine),
);
/**
every context, a new component adds its part here and its body below; the overview requires a title but a note's
*/
const contexts = [
  tuple([literal('chart'), props('chart', { kind: enums(['bar', 'split']), rows: some(row) })]),
  tuple([literal('code'), props('code', { code: words, lang })]),
  tuple([literal('compare'), props('compare', { lang, pair: tuple([words, words]) })]),
  tuple([literal('figure'), props('figure', { svg: words })]),
  tuple([literal('list'), props('list', { items: some(words) })]),
  tuple([literal('machine'), machineProps]),
  tuple([literal('note'), props('note', { text: words })]),
  tuple([literal('tabs'), props('tabs', { tabs })]),
] as const;
/**
the kinds of context, which the sketch of a plan checks first: a union of tuples guesses at a kind it does not know
*/
const KINDS = ['chart', 'code', 'compare', 'figure', 'list', 'machine', 'note', 'tabs'] as const;
const sketch = tuple([
  anything(),
  list(tuple([enums(KINDS), anything()])),
  record(tuple([anything(), list(tuple([enums([...KINDS, 'choice']), anything()]))])),
]);
/**
a question inside a question's body, answered by picks: one option, or any number with `pick: "many"`; its options
are keyed by value, so a value is never repeated
*/
const choice = refine(
  props('choice', {
    id,
    options: keyed(
      optionShape,
      'Expected at least one option, each value not a whole number (JS orders those first)',
      (value) => /^(?!\d+$).+$/u.test(value),
    ),
    pick: optional(enums(['many', 'one'])),
  }),
  'Expected exactly one lean option unless pick is "many"',
  (entry) =>
    entry.pick === 'many' ||
    Object.values(entry.options).filter((option) => option.lean).length === 1,
);
const choiceShape = tuple([literal('choice'), choice]);
/**
a question's body items: the contexts and the choice, which is answerable and so never in the overview
*/
const itemShape = union('context', [...contexts, choiceShape]);
const overviewShape = refine(
  union('context', contexts),
  'Expected a title',
  ([kind, { title }]) => kind === 'note' || title !== undefined,
);
const questionShape = refine(
  tuple([words, list(itemShape)]),
  'Expected choice ids distinct',
  ([, body]) => isDistinct(body.flatMap(([kind, own]) => (kind === 'choice' ? [own.id] : []))),
);
const planShape = tuple([
  words,
  list(overviewShape),
  keyed(
    questionShape,
    'Expected at least one question, each id a letter, then letters, digits, - or _',
    (name) => NAME.test(name),
  ),
]);

/**
what the server draws into a context's props: highlighted `html`, a machine's `svg`
*/
type Drawn = { html?: string[]; svg?: string };
/**
a part of a plan: a context, or a choice in a question's body
*/
type Item = Infer<typeof itemShape>;
type Choice = Infer<typeof choice>;
type Plan = Infer<typeof planShape>;
type Question = Plan[2][string];
type Option = Infer<typeof optionShape> & { value: string };
type MachineProps = Extract<Item, ['machine', unknown]>[1];
/**
a question he answers: its id, its title, then a composition of contexts and choices
*/
type Asked = { body: Item[]; id: string; title: string };
/**
what a Send carries: the picks and the option comments by choice id, then the message
*/
type Said = {
  message: string;
  notes: Record<string, Record<string, string>>;
  picks: Record<string, string[]>;
};
type Row = Infer<typeof row>;
type Tab = Infer<typeof tab>;
type Shown<I = Exclude<Item, ['choice', unknown]>> = I extends [infer K, infer P]
  ? [K, Drawn & P]
  : never;

/**
the keys of a path as the author writes them: `[0]` for an index, `.rows` for a field
*/
function dotted(keys: readonly PropertyKey[]): string {
  return keys.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('');
}
/**
what a question's slot says: its title, its body
*/
const SLOTS: Record<string, string> = { 0: '.title', 1: '.body' };
const ROOTS = ['title', 'overview', 'questions'];
/**
the length of a path to a context in a question's body: `[2, id, 1, index]`
*/
const ITEM_DEPTH = 4;

/**
a problem's place as the author reads it: `overview[1] chart.rows`, `land.body[0] choice.options`, a question
named by its id and a context by its kind
*/
function where(input: unknown, path: readonly PropertyKey[]): string {
  const [root, name, side, index] = path;
  /**
  a context's place: its kind, then `.kind` when the problem is the kind itself, else the field of its props
  */
  function context(label: string, keys: readonly PropertyKey[]): string {
    let at: unknown = input;
    for (const key of keys) {
      at = Reflect.get(new Object(at), key);
    }
    const kind = Array.isArray(at) && typeof at[0] === 'string' ? ` ${at[0]}` : '';
    const [slot, ...fields] = path.slice(keys.length);
    return `${label}${kind}${slot === 0 ? '.kind' : dotted(fields)}`;
  }
  if (root === 1 && name !== undefined) {
    return context(`overview[${String(name)}]`, path.slice(0, 2));
  }
  if (root === 2 && side === 1 && index !== undefined) {
    return context(`${String(name)}.body[${String(index)}]`, path.slice(0, ITEM_DEPTH));
  }
  if (root === undefined) {
    return 'plan';
  }
  return root === 2 && name !== undefined
    ? `${String(name)}${SLOTS[String(side)] ?? ''}`
    : String(ROOTS[Number(root)]);
}

/**
what xstate says of each machine in a plan whose fields all check, named as `where` names it
*/
function machines(plan: Plan): string[] {
  return [
    ...plan[1].map((item, index) => [[1, index], item] as const),
    ...Object.entries(plan[2]).flatMap(([name, [, body]]) =>
      body.map((item, index) => [[2, name, 1, index], item] as const),
    ),
  ].flatMap(([path, [kind, own]]) =>
    kind === 'machine'
      ? (MACHINE.problems?.(own) ?? []).map((problem) => `${where(plan, path)}.${problem}`)
      : [],
  );
}

/**
every problem in `input`, each naming the question or overview context and the field; empty when it renders
*/
function validate(input: unknown): string[] {
  const sketched = judge(input, sketch);
  const result = sketched.issues ? sketched : judge(input, planShape);
  return result.issues
    ? result.issues.map(({ message, path }) => `${where(input, path)}: ${message}`)
    : machines(result.value);
}

/**
a plan's questions in their authored order, each with its id
*/
function asking(plan: Plan): Asked[] {
  return Object.entries(plan[2]).map(([name, [title, body]]) => ({ body, id: name, title }));
}

// ─── bodies ──────────────────────────────────────────────────────────────────────────────────────
/**
the opacity of a split's segments, told apart without colour: white at falling opacity
*/
const OPAQUE = 0.9;
const STRONG = 0.6;
const FAINT = 0.35;
const GHOST = 0.18;
const SHADES = [OPAQUE, STRONG, FAINT, GHOST];
const WIDTH = 400;

/**
a two-column table, label then bar and count, so a row is one line high
*/
function Bars({ rows }: Readonly<{ rows: Row[] }>): ReactNode {
  const x = scaleLinear([0, Math.max(...rows.map(([, value]) => value)) || 1], [0, 1]);
  return (
    <table className="bars">
      <tbody>
        {rows.map(([label, value], index) => (
          <tr key={index}>
            <th>{label}</th>
            <td>
              {/* the longest bar leaves room for its count */}
              <span style={{ width: `calc((100% - 6ch) * ${x(value)})` }} />
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Split({ rows }: Readonly<{ rows: Row[] }>): ReactNode {
  const ends = rows.map((_row, index) =>
    rows.slice(0, index + 1).reduce((sum, [, value]) => sum + value, 0),
  );
  const x = scaleLinear([0, (ends.at(-1) ?? 0) || 1], [0, WIDTH]);
  return (
    <>
      <svg className="chart" role="img" viewBox={`0 0 ${WIDTH} 28`}>
        {rows.map(([, value], index) => (
          <rect
            fillOpacity={SHADES[index % SHADES.length]}
            height={28}
            key={index}
            width={x(value)}
            x={x((ends[index] ?? 0) - value)}
          />
        ))}
      </svg>
      <ul className="legend">
        {rows.map(([label, value], index) => (
          <li key={index}>
            <i style={{ opacity: SHADES[index % SHADES.length] }} />
            {`${label} · ${value}`}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
a code sample: the server's highlighted markup when it made one, else the plain text
*/
function Sample({ code, html }: Readonly<{ code: string; html?: string | undefined }>): ReactNode {
  return (html ?? '') === '' ? (
    <pre>
      <code>{code}</code>
    </pre>
  ) : (
    <div className="lit" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
  );
}

/**
a tabs context: a tab bar over the selected tab's sample, the one piece of client state
*/
function Tabs({
  html,
  tabs: all,
}: Readonly<{ html?: string[] | undefined; tabs: Tab[] }>): ReactNode {
  const [at, setAt] = useState(0);
  const code = all[at]?.[1] ?? '';
  return (
    <div className="tabs">
      <div className="tablist" role="tablist">
        {all.map(([label], index) => (
          <button
            aria-selected={index === at}
            key={index}
            onClick={() => {
              setAt(index);
            }}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <Sample code={code} html={html?.[at]} />
      </div>
    </div>
  );
}

/**
two samples side by side, today's and the alternative: the compare context
*/
function Pair({ html, pair }: Readonly<{ html?: string[]; pair: string[] }>): ReactNode {
  return (
    <div className="pair">
      {pair.map((code, index) => (
        <div key={index}>
          <small>{index ? 'alternative' : 'today'}</small>
          <Sample code={code} html={html?.[index]} />
        </div>
      ))}
    </div>
  );
}

/**
the question's choices, in body order
*/
function choicesOf({ body }: Asked): Choice[] {
  return body.flatMap(([kind, own]) => (kind === 'choice' ? [own] : []));
}
/**
a choice's options, each with its value, in authored order
*/
function optionsOf({ options }: Choice): Option[] {
  const all: Option[] = [];
  for (const [value, option] of Object.entries(options)) {
    all.push({ ...option, value });
  }
  return all;
}
/**
what `make` says of each choice, keyed by choice id, the choices it says nothing of left out
*/
function byChoice<T extends object>(
  choices: Choice[],
  make: (one: Choice) => T,
): Record<string, T> {
  return Object.fromEntries(
    choices
      .map((one) => [one.id, make(one)] as const)
      .filter(([, said]) => Object.keys(said).length > 0),
  );
}
/**
the choice's options among `values`, in authored order
*/
function picked(one: Choice, values: unknown[]): Option[] {
  return optionsOf(one).filter((option) => values.includes(option.value));
}
/**
what a Send says on the question's hud thread: each choice's picks (its title or id, then labels), each option comment
after its label, then the message
*/
function spoken(question: Asked, { message, notes, picks }: Said): string {
  const choices = choicesOf(question);
  return [
    ...choices
      .map((one) => [one, picked(one, picks[one.id] ?? [])] as const)
      .filter(([, chosen]) => chosen.length > 0)
      .map(
        ([one, chosen]) =>
          `${one.title ?? one.id}: ${chosen.map((option) => option.label).join(', ')}`,
      ),
    ...choices.flatMap((one) => {
      const said = notes[one.id] ?? {};
      return picked(one, Object.keys(said)).map(
        (option) => `${option.label}: ${said[option.value]}`,
      );
    }),
    message,
  ]
    .filter(Boolean)
    .join(' — ');
}

/**
the part of a body item or overview context only its kind draws
*/
function partOf([kind, own]: Shown): ReactNode {
  if (kind === 'chart') {
    return own.kind === 'bar' ? <Bars rows={own.rows} /> : <Split rows={own.rows} />;
  }
  if (kind === 'code') {
    return <Sample code={own.code} html={own.html?.[0]} />;
  }
  if (kind === 'compare') {
    return <Pair html={own.html} pair={own.pair} />;
  }
  if (kind === 'figure') {
    // the author is the local agent, so its markup goes in raw
    return <div className="figure" dangerouslySetInnerHTML={{ __html: own.svg }} />;
  }
  if (kind === 'list') {
    return (
      <ul>
        {own.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }
  if (kind === 'machine') {
    // drawn by the server (machine.ts); the same string renders and hydrates
    return <div className="machine" dangerouslySetInnerHTML={{ __html: own.svg ?? '' }} />;
  }
  return kind === 'note' ? <p>{own.text}</p> : <Tabs html={own.html} tabs={own.tabs} />;
}

export {
  LANGUAGES,
  MACHINE,
  asking,
  byChoice,
  choicesOf,
  optionsOf,
  partOf,
  picked,
  planShape,
  spoken,
  validate,
};
export type { Asked, Choice, Item, MachineProps, Option, Plan, Question, Said };
