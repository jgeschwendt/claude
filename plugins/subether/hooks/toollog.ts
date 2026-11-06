/**
The daily tool log: one JSON line per tool call, built-in and MCP, main loop and subagents, appended to
`<dir>/<local yyyy-mm-dd>.jsonl` after the call settles. Its arguments go in, cut; its result never does
*/
import type { EngineInterface, Hook, ToolCallInput, ToolCallResult } from 'claude-code';
import { field } from './gauge';
import { append } from './sandman';

/**
how much of each string argument a line keeps
*/
const CUT = 2000;
/**
the keys `tool.call` carries beside the tool's own arguments
*/
const RESERVED = new Set(['agentId', 'consent', 'requestMeta', 'tool', 'tool_use_id']);

/**
Every string in `value` cut at `limit` characters (2,000 by default), `…[cut <n> chars]` naming the rest
*/
const cut = (value: unknown, limit = CUT): unknown => {
  if (typeof value === 'string') {
    return value.length > limit
      ? `${value.slice(0, limit)}…[cut ${value.length - limit} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => cut(item, limit));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cut(item, limit)]));
};

/**
The tool's arguments: `e` without the reserved keys, cut
*/
const argumentsOf = (e: ToolCallInput): unknown =>
  cut(Object.fromEntries(Object.entries(e).filter(([key]) => !RESERVED.has(key))));

/**
A Bash record's flags and stderr's size, as JSON `{ interrupted, background, stderr }`; undefined off a Bash record
*/
const bashOf = (tool: string, result: ToolCallResult): string | undefined => {
  const record: unknown = result.isError === true ? undefined : result.result;
  const stderr = field(record, 'stderr');
  if (tool !== 'Bash' || typeof stderr !== 'string') {
    return undefined;
  }
  // the wire format, keys in this order
  return `{"interrupted":${String(field(record, 'interrupted') === true)},"background":${String(field(record, 'backgroundTaskId') !== undefined)},"stderr":${stderr.length}}`;
};

/**
`value` as JSON, `null` when absent
*/
const nullable = (value: string | undefined): string =>
  value === undefined ? 'null' : JSON.stringify(value);

const outcomeOf = (result: ToolCallResult): 'denied' | 'error' | 'ok' => {
  if (result.deny !== undefined) {
    return 'denied';
  }
  return result.isError === true ? 'error' : 'ok';
};

/**
The call's line, keys in the wire order: kind (`call`), at, session, agent, cwd, tool, id, ms, outcome, deny (a denial only), error,
readOnly, chars (what the model read, counted), bash (a Bash record only), input
*/
const lineOf = async (
  $: EngineInterface,
  e: ToolCallInput,
  call: { at: number; ms: number; result: ToolCallResult },
): Promise<string> => {
  const { result } = call;
  const [session, cwd] = await Promise.all([$.session.id(), $.session.cwd()]);
  // each value as JSON, absent ones left out
  const pairs: [string, string | undefined][] = [
    ['kind', '"call"'],
    [
      'at',
      JSON.stringify(
        Temporal.Instant.fromEpochMilliseconds(call.at).toString({ smallestUnit: 'millisecond' }),
      ),
    ],
    ['session', JSON.stringify(session)],
    ['agent', nullable(e.agentId)],
    ['cwd', JSON.stringify(cwd)],
    ['tool', JSON.stringify(e.tool)],
    ['id', nullable(e.tool_use_id)],
    ['ms', String(call.ms)],
    ['outcome', JSON.stringify(outcomeOf(result))],
    ['deny', result.deny === undefined ? undefined : JSON.stringify(result.deny)],
    ['error', String(result.isError === true)],
    ['readOnly', String(result.isReadOnly === true)],
    ['chars', String(result.text?.length ?? 0)],
    ['bash', bashOf(e.tool, result)],
    ['input', JSON.stringify(argumentsOf(e))],
  ];
  const fields = pairs
    .filter((pair): pair is [string, string] => pair[1] !== undefined)
    .map(([key, value]) => `"${key}":${value}`);
  return `{${fields.join(',')}}\n`;
};

/**
Logs every tool call once it settles, denied ones included, since this hook runs before the guards. The append is not awaited, so the model's turn never waits on it; a failed one is one dim log line
*/
const log: Hook<'tool.call'> = async ($, e, next) => {
  const at = await $.clock.now();
  const result = await next(e);
  const ms = (await $.clock.now()) - at;
  lineOf($, e, { at, ms, result })
    .then(async (line) => {
      await append($, at, line);
    })
    .catch((error: unknown) => {
      $.ui.log(`subether tool log: ${String(error)}`);
    });
  return result;
};

export { cut, log };
