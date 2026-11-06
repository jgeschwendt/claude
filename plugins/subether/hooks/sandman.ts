/**
The `~/.local/bin` runner, and the trail append perpetual's `append($, kind, rationale)` made. Each is a function
declaration: past an import the engine follows `$` only into one (`claude plugin validate`)
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
      $.ui.log(`subether: ${name} failed: ${String(error)}`);
    });
  if (ran === undefined || ran.exitCode === 0) {
    return ran?.stdout;
  }
  $.ui.log(
    `subether: ${name} exited ${ran.exitCode}: ${ran.stderr.trim().split('\n', 1)[0] ?? ''}`,
  );
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

export { run, trail };
