// State machines, server only: xstate, @xstate/graph and dagre never reach the client bundle. A plan's `machine`
// parts gain the drawn `svg` (states laid out by dagre, the walk lit in turn by SMIL), which the page renders as
// the server did, so a hydrate matches. Importing this installs the xstate half of validation into the catalog.
import { type GraphLabel, layout as arrange, graphlib } from '@dagrejs/dagre';
import { getSimplePaths, toDirectedGraph } from '@xstate/graph';
import {
  type AnyEventObject,
  type EventObject,
  type MachineContext,
  type MetaObject,
  type NonReducibleUnknown,
  type ParameterizedObject,
  type ProvidedActor,
  createMachine,
} from 'xstate';
import { type Item, MACHINE, type MachineProps } from './catalog.tsx';

type Spec = {
  config?: Record<string, unknown> | undefined;
  items?: string[] | undefined;
  loop?: true | undefined;
  walk?: string[] | undefined;
};
/**
createMachine with the meta type xstate leaves `any` pinned
*/
const build = createMachine<
  MachineContext,
  AnyEventObject,
  ProvidedActor,
  ParameterizedObject,
  ParameterizedObject,
  string,
  string,
  unknown,
  NonReducibleUnknown,
  EventObject,
  MetaObject
>;
type Machine = ReturnType<typeof build>;
type Edge = { from: string; label: string; to: string };
type Found = { edges: Edge[]; first: string; keys: string[]; walk: string[] };
type Outcome<T> = { problem: string } | { problem?: never; value: T };
type Point = Record<'x' | 'y', number>;
type Box = Partial<Point> & Record<'height' | 'width', number>;
type Path = Box & { labelpos: 'c'; points: Point[] };
type Laid = graphlib.Graph<GraphLabel, Box, Path>;
type Drawing = { layout: Laid; marker: string; spec: Spec; visits: string[] };
type Drawn = { problem?: never; svg: string } | { problem: string; svg?: never };

/**
the event a shorthand's chain edges carry, never drawn
*/
const NEXT = 'next';
const BOX = 44;
const CHAR = 9.6;
const EDGE_SEP = 20;
const KEY_DIGITS = 4;
const LABEL_CHAR = 7.6;
const LABEL_HEIGHT = 16;
const LABEL_PAD = 8;
const LIT = 0.35;
const LOOP_ARC = 16;
const LOOP_OUT = 44;
const LOOP_REACH = 10;
const MARGIN = 12;
const NAME_DROP = 5;
const NODE_PAD = 32;
const NODE_SEP = 40;
const NODE_WIDTH = 96;
const RANK_SEP = 70;
const STEP = 1.2;
const TEXT_DROP = 4;
const WRAP = 720;
const RADIX = 36;
const ENTITIES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

const esc = (text: string): string =>
  text.replaceAll(/["&'<>]/gu, (char) => ENTITIES[char] ?? char);
const px = (value: number): string => value.toFixed(1);
const wide = (text: string, em: number): number => Math.ceil(text.length * em);

/**
what `run` returns, or the xstate error it threw as a `config` problem
*/
const tried = <T>(run: () => T): Outcome<T> => {
  try {
    return { value: run() };
  } catch (error) {
    return { problem: `config: ${Error.isError(error) ? error.message : String(error)}` };
  }
};

/**
the xstate config of `spec`: its own, or a chain of `next` edges over the items, closed when it loops
*/
const configOf = ({ config, items = [], loop }: Spec): Record<string, unknown> =>
  config ?? {
    initial: 's0',
    states: Object.fromEntries(
      items.map((_item, index) => [
        `s${index}`,
        loop || index + 1 < items.length
          ? { on: { [NEXT]: `s${(index + 1) % items.length}` } }
          : {},
      ]),
    ),
  };

/**
the first state of a nested, parallel or history kind, described as a problem
*/
const nestedProblem = (machine: Machine): string | undefined => {
  const nested = Object.values(machine.root.states).find(
    (node) => node.type !== 'atomic' && node.type !== 'final',
  );
  return (
    nested &&
    `config: state "${nested.key}" is ${nested.type}; nested, parallel and history states are not drawn, so flatten the machine`
  );
};

/**
the walk: its own, every item of a shorthand, or the longest simple path of a config
*/
const walkOf = (spec: Spec, machine: Machine): string[] =>
  spec.walk ??
  (spec.items
    ? Array.from({ length: spec.items.length - 1 + Number(Boolean(spec.loop)) }, () => NEXT)
    : (getSimplePaths(machine)
        .map((path) => path.steps.slice(1).map((step) => step.event.type))
        .toSorted((one, other) => other.length - one.length)[0] ?? []));

/**
everything xstate says of the machine: its edges, states, initial state and walk
*/
const inspect = (spec: Spec, machine: Machine): Found => ({
  edges: toDirectedGraph(machine).children.flatMap((node) =>
    node.edges.map((edge) => ({
      from: edge.source.key,
      label: edge.label.text,
      to: edge.target.key,
    })),
  ),
  first: machine.root.initial.target?.[0]?.key ?? '',
  keys: Object.keys(machine.root.states),
  walk: walkOf(spec, machine),
});

/**
the name a state is drawn and reported under: a shorthand's item, a config's key
*/
const nameOf = (spec: Spec, key: string): string => spec.items?.[Number(key.slice(1))] ?? key;

/**
the states the walk visits from the first, or why an event cannot be sent where the walk stands
*/
const follow = (spec: Spec, { edges, first, walk }: Found): Outcome<string[]> => {
  const visits = [first];
  for (const event of walk) {
    const at = visits.at(-1) ?? '';
    const edge = edges.find((one) => one.from === at && one.label === event);
    if (!edge) {
      const takes = edges.filter((one) => one.from === at).map((one) => one.label);
      return {
        problem: `walk: "${event}" is not an event from "${nameOf(spec, at)}" (it takes: ${takes.join(', ') || 'nothing'})`,
      };
    }
    visits.push(edge.to);
  }
  return { value: visits };
};

/**
dagre's layout of the states and edges in one direction
*/
const placed = (spec: Spec, { edges, keys }: Found, rankdir: 'LR' | 'TB'): Laid => {
  const graph: Laid = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    edgesep: EDGE_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
    nodesep: NODE_SEP,
    rankdir,
    ranksep: RANK_SEP,
  });
  for (const key of keys) {
    const named = wide(nameOf(spec, key), CHAR) + NODE_PAD;
    graph.setNode(key, { height: BOX, width: Math.max(NODE_WIDTH, named) });
  }
  for (const [index, edge] of edges.entries()) {
    const text = spec.items ? '' : edge.label;
    graph.setEdge(
      edge.from,
      edge.to,
      {
        height: text ? LABEL_HEIGHT : 0,
        labelpos: 'c',
        points: [],
        width: text ? wide(text, LABEL_CHAR) + LABEL_PAD : 0,
      },
      String(index),
    );
  }
  arrange(graph);
  return graph;
};

/**
the layout left to right, or top to bottom when that is narrower and the first outgrows the page
*/
const laid = (spec: Spec, found: Found): Laid => {
  const across = placed(spec, found, 'LR');
  const down = (): Laid => placed(spec, found, 'TB');
  const tall = (across.graph().width ?? 0) > WRAP ? down() : across;
  return (tall.graph().width ?? 0) < (across.graph().width ?? 0) ? tall : across;
};

/**
the discrete fill-opacity walk of one state: lit while the walk is on it, the whole loop `visits.length` steps long
*/
const glow = (key: string, visits: string[]): string => {
  const { length } = visits;
  const times = visits.map((_visit, index) => (index / length).toFixed(KEY_DIGITS)).join(';');
  const values = visits.map((visit) => (visit === key ? LIT : 0)).join(';');
  return length > 1 && visits.includes(key)
    ? `<animate attributeName='fill-opacity' calcMode='discrete' dur='${(length * STEP).toFixed(1)}s' keyTimes='${times}' repeatCount='indefinite' values='${values}'/>`
    : '';
};

/**
where dagre put a box's centre; it always has, the types leave it optional for the input
*/
const centre = (box: Box): [number, number] => [Number(box.x), Number(box.y)];

/**
the path of an edge: dagre's route, or a loop on the right of the state for an edge back to itself
*/
const route = (layout: Laid, edge: Edge, points: Point[]): string => {
  const box = layout.node(edge.from);
  const { width } = box;
  const [cx, cy] = centre(box);
  const right = cx + width / 2;
  const [near, far] = [cy - LOOP_REACH, cy + LOOP_REACH].map((at) => px(at));
  return edge.from === edge.to
    ? `M${px(right)} ${near}C${px(right + LOOP_OUT)} ${px(cy - LOOP_ARC)} ${px(right + LOOP_OUT)} ${px(cy + LOOP_ARC)} ${px(right)} ${far}`
    : points.map((point, at) => `${at ? 'L' : 'M'}${px(point.x)} ${px(point.y)}`).join(' ');
};

/**
one edge: its arrow and, on a config, its event name
*/
const arrow = ({ layout, marker, spec }: Drawing, edge: Edge, index: number): string => {
  const { points, ...label } = layout.edge(edge.from, edge.to, String(index));
  const line = `<path d='${route(layout, edge, points)}' fill='none' marker-end='url(#${marker})' stroke-opacity='0.5'/>`;
  return spec.items || !edge.label
    ? line
    : `${line}<text fill-opacity='0.7' font-size='13' stroke='none' text-anchor='middle' x='${px(Number(label.x))}' y='${px(Number(label.y) + TEXT_DROP)}'>${esc(edge.label)}</text>`;
};

/**
one state: its box, lit by the walk, and its name
*/
const state = ({ layout, spec, visits }: Drawing, key: string): string => {
  const box = layout.node(key);
  const { height, width } = box;
  const [cx, cy] = centre(box);
  const lit = visits[0] === key ? LIT : 0;
  return `<rect fill='#fff' fill-opacity='${lit}' height='${height}' rx='12' width='${width}' x='${px(cx - width / 2)}' y='${px(cy - height / 2)}'>${glow(key, visits)}</rect><text font-size='16' stroke='none' text-anchor='middle' x='${px(cx)}' y='${px(cy + NAME_DROP)}'>${esc(nameOf(spec, key))}</text>`;
};

/**
the SVG of a machine that read cleanly: the arrows under the states
*/
const svgOf = (spec: Spec, found: Found, visits: string[]): string => {
  const layout = laid(spec, found);
  const { height = 0, width = 0 } = layout.graph();
  const marker = `m${Bun.hash(JSON.stringify(spec)).toString(RADIX)}`;
  const drawing = { layout, marker, spec, visits };
  const arrows = found.edges.map((edge, index) => arrow(drawing, edge, index));
  const states = found.keys.map((key) => state(drawing, key));
  const [across, down] = [Math.ceil(width), Math.ceil(height)];
  return `<svg fill='currentColor' height='${down}' role='img' stroke='currentColor' stroke-width='1.5' viewBox='0 0 ${across} ${down}' width='${across}'><defs><marker id='${marker}' markerHeight='6' markerWidth='6' orient='auto' refX='9' refY='5' viewBox='0 0 10 10'><path d='M0 0L10 5L0 10z' fill-opacity='0.5' stroke='none'/></marker></defs>${arrows.join('')}${states.join('')}</svg>`;
};

/**
the SVG of a machine part's props (a list of steps is the shorthand), or the problem with it
*/
const draw = ({ machine, ...rest }: MachineProps): Drawn => {
  const spec: Spec = Array.isArray(machine)
    ? { ...rest, items: machine }
    : { ...rest, config: machine };
  const made = tried(() => build(configOf(spec)));
  if (!('value' in made)) {
    return made;
  }
  const nested = nestedProblem(made.value);
  if (nested !== undefined) {
    return { problem: nested };
  }
  const found = tried(() => inspect(spec, made.value));
  if (!('value' in found)) {
    return found;
  }
  const walked = follow(spec, found.value);
  return 'value' in walked ? { svg: svgOf(spec, found.value, walked.value) } : walked;
};

MACHINE.problems = (props: MachineProps): string[] => {
  const { problem } = draw(props);
  return problem === undefined ? [] : [problem];
};

/**
a copy of `item` with `extra` among its props, which the tuple's two slots cannot say in types
*/
const graft = <T extends Item>(item: T, extra: Record<string, string | string[]>): T =>
  Object.assign([], item, { 1: { ...item[1], ...extra } });

/**
`item` with its drawn SVG when it is a machine; what is saved stays the author's own
*/
const drew = <T extends Item>(item: T): T => {
  const [kind, own]: Item = item;
  const { svg } = kind === 'machine' ? draw(own) : {};
  return svg === undefined ? item : graft(item, { svg });
};

export { drew, graft };
