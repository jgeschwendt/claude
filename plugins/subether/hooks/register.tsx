// subether: the first prompt's recall seed (the session's start mark too) and the recall pane, guards and the tool log,
// the gauge and window clock, the subagent pin and the session-end take; the shift band is to come.
import type { Register } from 'claude-code';
import { context, pull } from './context';
import { hint, measure, start, step } from './gauge';
import { bash, bashFailed, yml, ymlFailed } from './guard';
import { command, opening, pane } from './pane';
import { pin } from './pin';
import { take } from './take';
import { log, prompt } from './toollog';

export const register: Register = (on) => {
  // a spawn with no model, not a fork, under a premium parent runs on opus; a failed pin passes the spawn on
  on('agent.spawn', pin).catch(async ($, e, next) => await next(e));
  // `/subether` opens the recall pane asked
  on('command.run', { command: 'subether' }, command);
  // the first prompt with an ask, and the first under a new id (`/clear`), attaches the `sandman recall` seed, which
  // writes the start mark, as capped context; chunk 7 · `sandman report --hook` beside it
  on('prompt.submit', context).catch(async ($, e, next) => await next(e));
  // each prompt the person typed → the day's tool log, unjudged, once it entered: a matcher of its own, since a second
  // unmatched `prompt.submit` fails the load
  on('prompt.submit', { origin: { kind: 'composer' } }, prompt).catch(
    async ($, e, next) => await next(e),
  );
  // `sandman take` on every reason, under the end bound
  on('session.end', take).catch(async ($, e, next) => await next(e));
  // the gauge reading; the five-hour window → window.json
  on('session.measure', measure);
  // the gauge's first reading and its 15 s usage poll in interactive sessions
  on('session.start', start);
  // the recall pane, opened unasked, and `/subether`: a matcher of its own, since a second
  // unmatched `session.start` fails the load and `$` crosses an import only into a function declaration
  on('session.start', { isInteractive: true }, opening);
  // chunk 8 · /shift /trail and the shift row's timer join `start`; perpetual, which registered those names,
  // is uninstalled (2026-11-06), so subether may take them
  // every tool call → the day's tool log. First of the `tool.call` hooks, so outermost (hooks within one module run
  // in the order `register` called `on`): it sees each call the guards below deny
  on('tool.call', log).catch(async ($, e, next) => await next(e));
  // the Bash guard: deny a house-forbidden command, trail each denial. `decide` denies what it cannot read by returning
  // a reason; a guard that fails anyway denies the call through its `.catch`, fail closed
  on('tool.call', { tool: 'Bash' }, bash).catch(bashFailed);
  // deny an Edit/Write to a `.yml` path, trail the denial; fail closed too
  on('tool.call', { tool: ['Edit', 'Write'] }, yml).catch(ymlFailed);
  // each recall the agent pulls → the pane, the result passed on as it came; a pattern, since a tool name the mod's
  // types have not met yet fails the matcher's type
  on('tool.call', { tool: /^(?:Bash|mcp__sandman__recall)$/u }, pull).catch(
    async ($, e, next) => await next(e),
  );
  // the gauge's effort flag
  on('turn.step', step);
  // the gauge row under the prompt, the engine's hint beneath; chunk 8 · the shift row in the band
  // (AbovePrompt): shift · theme · repo · handoff · last trail event, the band left to the engine until then
  on('ui.render', { component: 'PromptHint' }, hint);
  // the recall pane's body
  on('ui.render', { component: 'Pane' }, pane);
};
