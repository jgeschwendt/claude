// subether: the first prompt's recall seed (the session's start mark too) and the recall pane, guards and the tool log,
// the gauge and window clock, the session-end take and the census feed; the shift band is to come.
import type { Register } from 'claude-code';
import { brief } from './brief';
import {
  added,
  asked,
  attached,
  called,
  commanded,
  compacted,
  configured,
  denied,
  elicited,
  ended,
  entered,
  failed,
  gauged,
  idled,
  interrupted,
  isolated,
  loaded,
  mentioned,
  moved,
  notified,
  prompted,
  received,
  released,
  reported,
  sensed,
  sent,
  skilled,
  spawned,
  started,
  stepped,
  stopped,
  switched,
  tasked,
  turnEnded,
  turnStarted,
  typed,
} from './census';
import { context, pull } from './context';
import { hint, measure, start, step } from './gauge';
import { bash, bashFailed, yml, ymlFailed } from './guard';
import { command, opening, pane } from './pane';
import { take } from './take';
import { log, prompt } from './toollog';

export const register: Register = (on) => {
  // every event, outermost so it hears each as raised → census `sense.new` for a name or field the manifest lacks;
  // no `.catch`: a failing observer is skipped, the event going on beneath as it came
  on('*', sensed);
  // the census feed (census.ts): each hook emits its event and answers what `next` answered. An agent's report →
  // `agent.end`
  on('agent.report', reported).catch(async ($, e, next) => next(e));
  // each spawn the engine started → `agent.spawn`, outermost, so it sees the model the engine settled
  on('agent.spawn', {}, spawned).catch(async ($, e, next) => next(e));
  // a new agent that is not a fork gets the house rules appended to its prompt; a failed brief passes the spawn on
  on('agent.spawn', { fork: false }, brief).catch(async ($, e, next) => next(e));
  // census, each classic hook observed: a settings or skills file changing → `config`
  on('classic.ConfigChange', configured).catch(async ($, e, next) => next(e));
  // a working directory change → `cwd`
  on('classic.CwdChanged', moved).catch(async ($, e, next) => next(e));
  // an `/add-dir` → `directory`
  on('classic.DirectoryAdded', added).catch(async ($, e, next) => next(e));
  // an MCP server's question to the person, and their answer → `elicit`
  on('classic.Elicitation', elicited).catch(async ($, e, next) => next(e));
  on('classic.ElicitationResult', elicited).catch(async ($, e, next) => next(e));
  // a memory or rules file loaded → the next `tasks`
  on('classic.InstructionsLoaded', loaded).catch(async ($, e, next) => next(e));
  // the engine calling for the person → `notify`
  on('classic.Notification', notified).catch(async ($, e, next) => next(e));
  // a call the mode's classifier refused → `tool.deny`
  on('classic.PermissionDenied', denied).catch(async ($, e, next) => next(e));
  // each permission request that reaches the person → `tool.wait` on the call in flight
  on('classic.PermissionRequest', asked).catch(async ($, e, next) => next(e));
  // a model switch → `model`
  on('classic.PostModelSwitch', switched).catch(async ($, e, next) => next(e));
  // each start, resume, fork, `/clear` and compaction → `session.open`
  on('classic.SessionStart', entered).catch(async ($, e, next) => next(e));
  // each end of a turn → `tasks`, the background shells, monitors and wakeups still in flight
  on('classic.Stop', stopped).catch(async ($, e, next) => next(e));
  // an API error ending a turn → `turn.fail`
  on('classic.StopFailure', failed).catch(async ($, e, next) => next(e));
  // the team's task list → `todo`
  on('classic.TaskCompleted', tasked).catch(async ($, e, next) => next(e));
  on('classic.TaskCreated', tasked).catch(async ($, e, next) => next(e));
  // a teammate gone quiet → `teammate.idle`
  on('classic.TeammateIdle', idled).catch(async ($, e, next) => next(e));
  // each slash command → census `command`, by name. `{}`: a registration of its own beside `/subether`'s, and outermost,
  // so it sees the command `/subether` answers alone
  on('command.run', {}, commanded).catch(async ($, e, next) => next(e));
  // `/subether` opens the recall pane asked
  on('command.run', { command: 'subether' }, command);
  // each typing burst in the prompt box → census `typing`, the text never read
  on('prompt.edit', typed).catch(async ($, e, next) => next(e));
  // each `@` path a prompt names → census `mention`
  on('prompt.mention', mentioned).catch(async ($, e, next) => next(e));
  // each prompt that is not meta → census `prompt`
  on('prompt.submit', {}, prompted).catch(async ($, e, next) => next(e));
  // the first prompt with an ask, and the first under a new id (`/clear`), attaches the `sandman recall` seed, which
  // writes the start mark, as capped context; chunk 7 · `sandman report --hook` beside it
  on('prompt.submit', context).catch(async ($, e, next) => next(e));
  // each prompt the person typed → the day's tool log, unjudged, once it entered: a matcher of its own, since a second
  // unmatched `prompt.submit` fails the load
  on('prompt.submit', { origin: { kind: 'composer' } }, prompt).catch(async ($, e, next) =>
    next(e),
  );
  // a remote client joining and leaving → census `client`
  on('session.attach', attached).catch(async ($, e, next) => next(e));
  // each compaction → census `compact` and `compact.end`
  on('session.compact', compacted).catch(async ($, e, next) => next(e));
  on('session.detach', attached).catch(async ($, e, next) => next(e));
  // each end → census `session.end`, ahead of the take
  on('session.end', {}, ended).catch(async ($, e, next) => next(e));
  // `sandman take` on every reason, under the end bound
  on('session.end', take).catch(async ($, e, next) => next(e));
  // each usage reading that changed → census `usage`
  on('session.measure', {}, gauged).catch(async ($, e, next) => next(e));
  // the gauge reading; the five-hour window → window.json
  on('session.measure', measure);
  // each delivery and each message sent → census `message.receive` and `message.send`
  on('session.receive', received).catch(async ($, e, next) => next(e));
  on('session.send', sent).catch(async ($, e, next) => next(e));
  // each start → census `session.start`
  on('session.start', {}, started).catch(async ($, e, next) => next(e));
  // the gauge's first reading and its 15 s usage poll in interactive sessions
  on('session.start', start);
  // the recall pane, opened unasked, and `/subether`: a matcher of its own, since a second
  // unmatched `session.start` fails the load and `$` crosses an import only into a function declaration
  on('session.start', { isInteractive: true }, opening);
  // the person's Stop → census `stop`
  on('session.stop', interrupted).catch(async ($, e, next) => next(e));
  // each skill expanded → census `skill`
  on('skill.prompt', skilled).catch(async ($, e, next) => next(e));
  // chunk 8 · /shift /trail and the shift row's timer join `start`; perpetual, which registered those names,
  // is uninstalled (2026-11-06), so subether may take them
  // each tool call → census `tool.start` and `tool.end`, unawaited; outermost, so a denied call ends too
  on('tool.call', {}, called).catch(async ($, e, next) => next(e));
  // every tool call → the day's tool log. First of the `tool.call` hooks, so outermost (hooks within one module run
  // in the order `register` called `on`): it sees each call the guards below deny
  on('tool.call', log).catch(async ($, e, next) => next(e));
  // the Bash guard: deny a house-forbidden command, trail each denial. `decide` denies what it cannot read by returning
  // a reason; a guard that fails anyway denies the call through its `.catch`, fail closed
  on('tool.call', { tool: 'Bash' }, bash).catch(bashFailed);
  // deny an Edit/Write to a `.yml` path, trail the denial; fail closed too
  on('tool.call', { tool: ['Edit', 'Write'] }, yml).catch(ymlFailed);
  // each recall the agent pulls → the pane, the result passed on as it came; a pattern, since a tool name the mod's
  // types have not met yet fails the matcher's type
  on('tool.call', { tool: /^(?:Bash|mcp__sandman__recall)$/u }, pull).catch(async ($, e, next) =>
    next(e),
  );
  // each loop's turn, the main conversation's and an agent's → census `turn.complete` and `turn.start`
  on('turn.complete', turnEnded).catch(async ($, e, next) => next(e));
  on('turn.start', turnStarted).catch(async ($, e, next) => next(e));
  // each model request → census `step`, every chunk passed on: `{}`, a registration of its own beside the gauge's
  on('turn.step', {}, stepped).catch(async function* passed($, e, next) {
    return yield* next(e);
  });
  // the gauge's effort flag
  on('turn.step', step);
  // each worktree made and given back → census `worktree` and `worktree.end`
  on('vcs.isolate', isolated).catch(async ($, e, next) => next(e));
  on('vcs.release', released).catch(async ($, e, next) => next(e));
  // the gauge row under the prompt, the engine's hint beneath; chunk 8 · the shift row in the band
  // (AbovePrompt): shift · theme · repo · handoff · last trail event, the band left to the engine until then
  on('ui.render', { component: 'PromptHint' }, hint);
  // the recall pane's body
  on('ui.render', { component: 'Pane' }, pane);
};
