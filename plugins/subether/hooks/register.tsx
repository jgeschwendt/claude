// subether: the harness's session hooks, guards and window clock, plus the gauge, the injected pane and shift band.
import type { Register } from 'claude-code';
import { context } from './context';
import { hint, measure, start, step } from './gauge';
import { bash, bashFailed, yml, ymlFailed } from './guard';
import { markers } from './markers';
import { command, opening, pane } from './pane';
import { log } from './toollog';

export const register: Register = (on) => {
  // chunk 5 · pin an unpinned, unforked subagent to opus
  on('agent.spawn', async ($, e, next) => await next(e)).catch(async ($, e, next) => await next(e));
  // chunk 6 · hand the notification to `docket --hook`
  on(
    'classic.Notification',
    { notification_type: ['agent_needs_input', 'idle_prompt', 'permission_prompt'] },
    async ($, e, next) => await next(e),
  ).catch(async ($, e, next) => await next(e));
  // `/subether` opens the injected pane asked
  on('command.run', { command: 'subether' }, command);
  // the first prompt attaches `sandman recall` as capped context; chunks 6/7 · docket sweep and digest, the other
  // first-prompt sources
  on('prompt.submit', context).catch(async ($, e, next) => await next(e));
  // each prompt the person typed is judged for markers once it entered, each one at 0.8 trailed: a matcher of its
  // own, since a second unmatched `prompt.submit` fails the load
  on('prompt.submit', { origin: { kind: 'composer' } }, markers).catch(
    async ($, e, next) => await next(e),
  );
  // chunk 6 · `sandman take` and the session's docket resolve under the end budget
  on('session.end', async ($, e, next) => await next(e));
  // the gauge reading; the five-hour window → window.json
  on('session.measure', measure);
  // the gauge's first reading, and its 15 s usage poll in interactive sessions
  on('session.start', start);
  // the injected pane, opened unasked, `/subether`, and the judges' probe: a matcher of its own, since a second
  // unmatched `session.start` fails the load and `$` crosses an import only into a function declaration
  on('session.start', { isInteractive: true }, opening);
  // chunk 8 · /docket /shift /trail and the shift row's timer join `start`. The commands stay
  // perpetual's until cutover: a name registered twice throws in the second mod's session.start
  // every tool call → the day's tool log. First of the `tool.call` hooks, so outermost (hooks within one module run
  // in the order `register` called `on`): it sees each call the guards below deny
  on('tool.call', log).catch(async ($, e, next) => await next(e));
  // the Bash guard: deny a house-forbidden command, trail each denial. `decide` denies what it cannot read by returning
  // a reason; a guard that fails anyway denies the call through its `.catch`, fail closed
  on('tool.call', { tool: 'Bash' }, bash).catch(bashFailed);
  // deny an Edit/Write to a `.yml` path, trail the denial; fail closed too
  on('tool.call', { tool: ['Edit', 'Write'] }, yml).catch(ymlFailed);
  // the gauge's effort flag
  on('turn.step', step);
  // chunk 6 · hand the main loop's answer to `docket --hook` as a Stop payload
  on('turn.complete', async ($, e, next) => await next(e));
  // the gauge row under the prompt, the engine's hint beneath; chunk 8 · the shift row in the band
  // (AbovePrompt): shift · theme · repo · handoff · last trail event, left to perpetual until then
  on('ui.render', { component: 'PromptHint' }, hint);
  // the injected pane's body
  on('ui.render', { component: 'Pane' }, pane);
};
