/**
The session-end take: `sandman take --hook` on the SessionEnd payload sandman reads (`cwd`, `reason`, `session_id`;
sandman src/hook.rs `session_end`), for every reason. sandman decides, `take --help`: "--hook reads a SessionEnd payload
on stdin and exits quietly when it names no session, names one whose files forget already destroyed, or carries
reason=resume … It also exits quietly when a live background job under ~/.claude/jobs would resume the session … and
reason=clear reaches past that guard — an operator's wipe ends the transcript for good. A live-job decline is a debt,
not a dead end: the owed take is written to <root>/pending-takes/<sid>.json"
*/
import type { Hook } from 'claude-code';
import { run } from './sandman';

/**
the whole chain's one short wall-clock bound, `$` waits and core included (claude-code.d.ts 2.1.318, SessionEndInput,
lines 11919–11926)
*/
const TAKE = 1500;

/**
Runs the take, awaited, since the session is ending, then the engine's end step with `e` as it came. A take that fails
is `run`'s log line
*/
const take: Hook<'session.end'> = async ($, e, next) => {
  const cwd = await $.session.cwd();
  const stdin = `{"cwd":${JSON.stringify(cwd)},"hook_event_name":"SessionEnd","reason":${JSON.stringify(e.reason)},"session_id":${JSON.stringify(e.sessionId)}}`;
  await run($, ['sandman', 'take', '--hook'], { stdin, timeoutMs: TAKE });
  // chunk 6 · docket resolve <id> --reason "session ended" per notification thread of the session, by id
  return await next(e);
};

export { take };
