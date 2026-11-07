// subether: first-prompt recall and the injected pane, guards and the tool log, judged markers and the shadow check, the
// gauge and window clock, the subagent pin and the session-end take; the docket hooks and the shift band are stubs or to
// come.
import type { Register } from 'claude-code';
import { check } from './check';
import { context } from './context';
import { hint, measure, start, step } from './gauge';
import { bash, bashFailed, yml, ymlFailed } from './guard';
import { markers } from './markers';
import { command, opening, pane } from './pane';
import { pin } from './pin';
import { take } from './take';
import { log } from './toollog';

export const register: Register = (on) => {
  // a spawn with no model, not a fork, under a premium parent runs on opus; a failed pin passes the spawn on
  on('agent.spawn', pin).catch(async ($, e, next) => await next(e));
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
  // `sandman take --hook` on every reason, under the end bound; chunk 6 · the session's docket resolve beside it
  on('session.end', take).catch(async ($, e, next) => await next(e));
  // the gauge reading; the five-hour window → window.json
  on('session.measure', measure);
  // the gauge's first reading, and its 15 s usage poll in interactive sessions
  on('session.start', start);
  // the injected pane, opened unasked, `/subether`, and the judges' probe: a matcher of its own, since a second
  // unmatched `session.start` fails the load and `$` crosses an import only into a function declaration
  on('session.start', { isInteractive: true }, opening);
  // chunk 8 · /docket /shift /trail and the shift row's timer join `start`; perpetual, which registered those names,
  // is uninstalled (2026-11-06), so subether may take them
  // every tool call → the day's tool log. First of the `tool.call` hooks, so outermost (hooks within one module run
  // in the order `register` called `on`): it sees each call the guards below deny
  on('tool.call', log).catch(async ($, e, next) => await next(e));
  // the Bash guard: deny a house-forbidden command, trail each denial. `decide` denies what it cannot read by returning
  // a reason; a guard that fails anyway denies the call through its `.catch`, fail closed
  on('tool.call', { tool: 'Bash' }, bash).catch(bashFailed);
  // deny an Edit/Write to a `.yml` path, trail the denial; fail closed too
  on('tool.call', { tool: ['Edit', 'Write'] }, yml).catch(ymlFailed);
  // chunk 5b · shadow: the judge's probabilities beside core's decision; flips to allow/deny once a week of lines gives
  // the thresholds
  on('tool.check', check).catch(async ($, e, next) => await next(e));
  // the gauge's effort flag
  on('turn.step', step);
  // chunk 6 · hand the main loop's answer to `docket --hook` as a Stop payload
  on('turn.complete', async ($, e, next) => await next(e));
  // the gauge row under the prompt, the engine's hint beneath; chunk 8 · the shift row in the band
  // (AbovePrompt): shift · theme · repo · handoff · last trail event, the band left to the engine until then
  on('ui.render', { component: 'PromptHint' }, hint);
  // the injected pane's body
  on('ui.render', { component: 'Pane' }, pane);
};
