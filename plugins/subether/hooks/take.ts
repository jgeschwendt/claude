/**
The session-end take: `sandman take` on every reason, since the binary decides (no start mark, `resume`, a session
a background job still names) and records the end in sandman's ledger; contract: the sandman repo's AGENTS.md
`### sandman take`. The start mark it needs is the seed's (context.ts)
*/
import type { Hook } from 'claude-code';
import { run } from './sandman';

/**
the whole chain's one short wall-clock bound, `$` waits and core included (claude-code.d.ts 2.1.318, SessionEndInput,
lines 11919–11926)
*/
const TAKE = 1500;

/**
Awaited, since the session is ending, then the engine's end step with `e` as it came; a failure is `run`'s log line
*/
const take: Hook<'session.end'> = async ($, e, next) => {
  const stdin = JSON.stringify({
    cwd: await $.session.cwd(),
    reason: e.reason,
    session: e.sessionId,
  });
  await run($, ['sandman', 'take'], { stdin, timeoutMs: TAKE });
  return next(e);
};

export { take };
