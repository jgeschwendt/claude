/**
The `~/.local/bin` runner, the trail append perpetual's `append($, kind, rationale)` made, the daily tool log's append
and its line builder. Each is a function declaration: past an import the engine follows `$` only into one (`claude plugin
validate`)
*/
import type { EngineInterface, ProcessRunInit } from 'claude-code';

/**
perpetual's trail append timeout
*/
const TRAIL_TIMEOUT = 5000;
/**
how many words of argv a log line names it by: the binary and its verb
*/
const NAME_WORDS = 3;

/**
`$HOME/.local/bin/<argv[0]>` run on the rest; resolves its stdout, or undefined after one dim log line when it cannot
start, times out or exits non-zero. Never rejects: no binary may break a session
*/
async function run(
  $: EngineInterface,
  argv: readonly string[],
  init?: ProcessRunInit,
): Promise<string | undefined> {
  const [bin = '', ...rest] = argv;
  const name = argv.slice(0, NAME_WORDS).join(' ');
  const home = (await $.env.get('HOME')) ?? '';
  const ran = await $.process
    .run([`${home}/.local/bin/${bin}`, ...rest], init)
    .catch((error: unknown) => {
      $.ui.log(`${name} failed: ${String(error)}`);
    });
  if (ran === undefined || ran.exitCode === 0) {
    return ran?.stdout;
  }
  $.ui.log(`${name} exited ${ran.exitCode}: ${ran.stderr.trim().split('\n', 1)[0] ?? ''}`);
  return undefined;
}

/**
`sandman trail append --kind <kind> --rationale <rationale> --ref session:<id>`, plus `--shift $SANDMAN_SHIFT` when
set, within 5 s; a failure is `run`'s log line
*/
async function trail($: EngineInterface, kind: string, rationale: string): Promise<void> {
  const [id, shift] = await Promise.all([$.session.id(), $.env.get('SANDMAN_SHIFT')]);
  const argv = ['sandman', 'trail', 'append', '--kind', kind, '--rationale', rationale];
  const tail = shift === undefined || shift === '' ? [] : ['--shift', shift];
  await run($, [...argv, '--ref', `session:${id}`, ...tail], { timeoutMs: TRAIL_TIMEOUT });
}

/**
Appends one JSON line to the daily tool log, `<dir>/<yyyy-mm-dd>.jsonl` for the local day of `at`: `<dir>` is
`$CLAUDE_TOOL_LOG_DIR`, else `$XDG_STATE_HOME/subether/tools`, else `~/.local/state/subether/tools`. `cat >>` opens it
O_APPEND, so a line written in one `write` lands whole beside other sessions' lines; a failed append rejects
*/
async function append($: EngineInterface, at: number, line: string): Promise<void> {
  const day = Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDate()
    .toString();
  const [override = '', state = '', home = ''] = await Promise.all([
    $.env.get('CLAUDE_TOOL_LOG_DIR'),
    $.env.get('XDG_STATE_HOME'),
    $.env.get('HOME'),
  ]);
  const base = state === '' ? `${home}/.local/state` : state;
  const path = `${override === '' ? `${base}/subether/tools` : override}/${day}.jsonl`;
  const script = 'mkdir -p "$(dirname "$1")" && cat >> "$1"';
  const appended = await $.process.run(['/bin/sh', '-c', script, '_', path], { stdin: line });
  if (appended.exitCode !== 0) {
    throw new Error(`${path}: ${appended.stderr.trim()}`);
  }
}

/**
`pairs` as a JSON object, keys in their order, each value JSON and `null` when undefined (`JSON.stringify` of an absent
field)
*/
function object(pairs: [string, string | undefined][]): string {
  return `{${pairs.map(([key, value]) => `"${key}":${value ?? 'null'}`).join(',')}}`;
}

export { append, object, run, trail };
