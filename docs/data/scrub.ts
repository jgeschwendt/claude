#!/usr/bin/env bun
// The public samples behind subether.html's log and markers charts, scrubbed from this machine's private files: the
// day's tool log (~/.local/state/subether/tools/<day>.jsonl) → sample-calls.json, and the month's sandman trail
// (~/.sandman/trail/<yyyy>/<mm>/*.jsonl) → sample-markers.json. Only the fields below survive; session, agent, cwd, id,
// input, deny text, reasons and rationale never leave. Times are local. scripts/charts.ts gates the keys.
//   bun docs/data/scrub.ts [yyyy-mm-dd]
const DAY = Bun.argv[2] ?? '2026-11-06';
const HOME = Bun.env.HOME ?? '';
const OUT = new URL('.', import.meta.url).pathname;

type Line = Record<string, unknown> & { at: string };

const lines = async (path: string): Promise<Line[]> =>
  (await Bun.file(path).text())
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line);

/**
a row per line, a line per row, so a diff reads row by row
*/
const write = async (name: string, rows: unknown[]): Promise<void> => {
  await Bun.write(`${OUT}${name}`, `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`);
};

/**
a built-in tool by name; every MCP tool is `mcp`, its server and tool names private
*/
const toolOf = (tool: unknown): string => (String(tool).startsWith('mcp__') ? 'mcp' : String(tool));

const calls = (await lines(`${HOME}/.local/state/subether/tools/${DAY}.jsonl`)).map((line) => {
  const hour = new Date(line.at).getHours();
  const tool = toolOf(line.tool);
  if (line.kind === 'check') {
    const core = line.core as { decision: string };
    const markers = line.markers as Record<string, number>;
    const { destructive, outbound, routine, secrets } = markers;
    return { decision: core.decision, destructive, hour, kind: 'check', ms: line.ms, outbound, routine, secrets, tool };
  }
  const { chars, ms, outcome, readOnly } = line;
  return { chars, hour, kind: 'call', ms, outcome, readOnly, tool };
});

const [year, month] = DAY.split('-');
const trail = new Bun.Glob('*.jsonl').scanSync(`${HOME}/.sandman/trail/${year}/${month}`);
const PREFIXES = ['repeated instruction', 'preference', 'approval'];
const markers = (await Promise.all([...trail].toSorted().map(async (file) => await lines(`${HOME}/.sandman/trail/${year}/${month}/${file}`))))
  .flat()
  .filter((event) => event.kind === 'correction')
  .map((event) => {
    const at = new Date(event.at);
    const rationale = String(event.rationale);
    const suffix = /\(p=(?<p>[\d.]+), (?<judge>\w+)\)$/u.exec(rationale)?.groups;
    const prefix = PREFIXES.find((name) => rationale.startsWith(`${name}: `)) ?? 'correction';
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    return suffix === undefined
      ? { day, hour: at.getHours(), judge: null, marker: 'regex', p: null }
      : { day, hour: at.getHours(), judge: suffix.judge, marker: prefix, p: Number(suffix.p) };
  });

await Promise.all([write('sample-calls.json', calls), write('sample-markers.json', markers)]);
console.log(`${calls.length} tool-log lines, ${markers.length} correction events`);
