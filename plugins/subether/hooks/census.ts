/**
The census feed: each session's start, opening and end, each agent's spawn and end, each loop's turns, model requests
and tool calls, each prompt, typing burst, mention, slash command and skill, each usage reading, compaction, model
switch, interrupt and failed turn, each message sent or received, each remote client, worktree, notification
and end-of-turn snapshot of background work, one JSON event apiece into `census emit`, which appends it to the ledger
`census state` and `census watch` fold (contract: the census repo's `src/fold.rs`); and its senses, each event name and
field the engine raises that the manifest (`senses.ts`) does not know. It observes only: every hook answers what `next`
answered, and a `census` that is missing, slow or failing is `run`'s one log line
*/
import {
  type AnyEventHook,
  type ClassicHookInputs,
  type EngineInterface,
  type Hook,
  type SessionAttachInput,
  type SessionDetachInput,
  type SessionVersion,
  type StreamHook,
  type ToolCallInput,
  atom,
  read,
  update,
} from 'claude-code';
import { field } from './gauge';
import { run } from './sandman';
import { senses } from './senses';
import { outcomeOf } from './toollog';

/**
one emit's bound
*/
const EMIT = 500;
/**
how much of a prompt, a report, a message, a tool's target or an error an event carries
*/
const HEAD = 200;
/**
the argument a tool call is named by, the first present: what it reads, runs or asks, in that precedence
*/
const TARGETS = [
  'file_path',
  'notebook_path',
  'path',
  'command',
  'pattern',
  'url',
  'query',
  'skill',
  'description',
  'prompt',
] as const;
/**
the shortest gap between two `typing` events, in milliseconds: one per burst, however fast the keys
*/
const TYPING = 5000;

/**
the running agents a workflow script started: `agent.report` is not raised for them, so their own `turn.complete` ends
them
*/
const workflows = atom({ key: 'workflows', plugin: 'subether' } as const, []);

/**
the fields an event's namespace carries at run time that the types do not declare, reviewed
*/
const undeclared: Record<string, string[] | undefined> = senses.undeclared;
/**
An event's fields, as offered and as reviewed undeclared
*/
const fieldsOf = (name: string, offered: string[]): Set<string> =>
  new Set([offered, undeclared[`${name.split('.', 1)[0] ?? ''}.*`] ?? []].flat());
/**
each event the manifest knows by name, with the fields it offers; every field for a call on `$`, for `engine.create`
(no `$` to emit with) and for an event that carries a tool's arguments, whose names are the tool's
*/
const known = new Map<string, Pick<ReadonlySet<string>, 'has'>>(
  Object.entries(senses.unsubscribed).map(([name, fields]): [string, Set<string>] => [
    name,
    fieldsOf(name, fields),
  ]),
);
for (const [name, fields] of Object.entries(senses.events)) {
  known.set(name, fieldsOf(name, [fields.read, fields.unread].flat()));
}
for (const name of [senses.args, senses.ops, ['engine.create']].flat()) {
  known.set(name, { has: (): boolean => true });
}
/**
the key of a `sense.new` for a name the manifest lacks: JSON's null, as the ledger's contract spells it
*/
const UNNAMED = JSON.parse('null') as null;

/**
A hook two events share, the second's input told apart by its own fields; `next` handed the input as it came
*/
type Shared<E> = <T extends E, R>(
  $: EngineInterface,
  e: T,
  next: (e: T) => Promise<R>,
) => Promise<R>;

/**
The feed's own memory, gone at a reload: `calls`, each loop's call in flight by `<agent>:<tool>`, since a permission
request names its tool and not its call; `loaded`, the instruction files loaded since the last end of turn, which
carries them; `measured`, what the last `usage` event said, so a reading that changed nothing is not emitted again;
`queue`, the emits in flight, one behind the other, so the ledger keeps the order the hooks fired in and a call's end is
never ahead of its start; `session`, the id the feed last read, for the events that must not read it themselves, unset
until a turn, a prompt or the session's start or opening reads it and after its end; `sensed`, each `<event> <key>` a
`sense.new` went for since the session's end; `typed`, when the last `typing` went
*/
const feed: {
  calls: Record<string, string | undefined>;
  loaded: object[];
  measured: string;
  queue: Promise<void>;
  sensed: Set<string>;
  session?: string;
  typed: number;
} = {
  calls: {},
  loaded: [],
  measured: '',
  queue: Promise.resolve(),
  sensed: new Set(),
  typed: -TYPING,
};

/**
`work` queued behind the emits before it; a failure is one log line
*/
const enqueue = async ($: EngineInterface, work: () => Promise<void>): Promise<void> => {
  feed.queue = feed.queue.then(work).catch((error: unknown) => {
    $.ui.log(`census: ${String(error)}`);
  });
  await feed.queue;
};

/**
`census emit` on `{event, session, …fields}`, which stamps the time itself: `session` the one the feed knows unless
`fields` names one, the event dropped while it knows none
*/
const post = async ($: EngineInterface, event: string, fields: object): Promise<void> => {
  if (feed.session === undefined) {
    return;
  }
  const stdin = JSON.stringify({ event, session: feed.session, ...fields });
  await run($, ['census', 'emit'], { stdin, timeoutMs: EMIT });
};

/**
An event under the session id read now (a `/clear`'s new one is picked up), settled once it is in the ledger; fields
still being read keep its place in the queue
*/
const emit = async (
  $: EngineInterface,
  event: string,
  fields: object | Promise<object>,
): Promise<void> => {
  await enqueue($, async () => {
    feed.session = await $.session.id();
    await post($, event, await fields);
  });
};

/**
An event under the id the feed already knows, nothing waiting on it and nothing of the session's read for it
*/
const note = ($: EngineInterface, event: string, fields: object): void => {
  void enqueue($, async () => {
    await post($, event, fields);
  });
};

/**
`reading`'s answer, or undefined where it rejects: a reader the host lacks leaves its field out
*/
const quiet = async <T>(reading: Promise<T>): Promise<T | undefined> =>
  await reading.catch((): undefined => undefined);

/**
`event` with the engine's version, as `senses` and `sense.new` carry it, left out where it cannot be read (a build
lacking the call throws where it is made)
*/
const sense = async ($: EngineInterface, event: string, fields: object): Promise<void> => {
  const version = async (): Promise<SessionVersion> => await $.session.version();
  await emit(
    $,
    event,
    quiet(version()).then((running) => ({ engine: running?.version, ...fields })),
  );
};

/**
The call's target, cut: its first `TARGETS` argument that is a string
*/
const targetOf = (e: ToolCallInput): string | undefined =>
  TARGETS.map((key) => field(e, key))
    .find((value) => typeof value === 'string')
    ?.slice(0, HEAD);

/**
The classic DirectoryAdded, `/add-dir` or a host's → `directory`
*/
const added: Hook<'classic.DirectoryAdded'> = async ($, e, next) => {
  note($, 'directory', { path: e.directory, source: e.source });
  return await next(e);
};

/**
The classic PermissionRequest, raised when a call's permission goes to the person → `tool.wait` on that loop's call of
the tool in flight; a mode that settles the call with no person raises none
*/
const asked: Hook<'classic.PermissionRequest'> = async ($, e, next) => {
  note($, 'tool.wait', { agent: e.agent_id, id: feed.calls[`${e.agent_id ?? ''}:${e.tool_name}`] });
  return await next(e);
};

/**
A remote client joining the session's roster, or (`reason` set) leaving it → `client`, with where and how large it
draws
*/
const attached: Shared<SessionAttachInput | SessionDetachInput> = async ($, e, next) => {
  const { clientId, surface } = e;
  note($, 'client', {
    client: clientId,
    reason: field(e, 'reason'),
    surface,
    viewport: field(e, 'viewport'),
  });
  return await next(e);
};

/**
A tool call → `tool.start`, then `tool.end` with its outcome, what the model read of it counted, whether it ran
read-only, and the head of its error or denial
*/
const called: Hook<'tool.call'> = async ($, e, next) => {
  const call = { agent: e.agentId, id: e.tool_use_id, target: targetOf(e), tool: e.tool };
  const key = `${e.agentId ?? ''}:${e.tool}`;
  feed.calls[key] = e.tool_use_id;
  note($, 'tool.start', call);
  const result = await next(e);
  feed.calls[key] = undefined;
  note($, 'tool.end', {
    ...call,
    chars: result.text?.length,
    deny: result.deny?.slice(0, HEAD),
    error: result.isError && result.text?.slice(0, HEAD),
    outcome: outcomeOf(result),
    readOnly: result.isReadOnly,
  });
  return result;
};

/**
A slash command about to run → `command` by name and origin, never its arguments
*/
const commanded: Hook<'command.run'> = async ($, e, next) => {
  note($, 'command', { command: e.command, origin: e.origin.kind });
  return await next(e);
};

/**
A compaction → `compact`, then `compact.end` with the conversation's tokens before and after, or why it was skipped
*/
const compacted: Hook<'session.compact'> = async ($, e, next) => {
  note($, 'compact', { agent: e.agentId, trigger: e.trigger });
  const result = await next(e);
  note($, 'compact.end', {
    after: field(result, 'tokensAfter'),
    agent: e.agentId,
    before: field(result, 'tokensBefore'),
    skip: result.skip,
  });
  return result;
};

/**
The classic ConfigChange, a settings file or the skills changing under the session → `config`
*/
const configured: Hook<'classic.ConfigChange'> = async ($, e, next) => {
  note($, 'config', { path: e.file_path, source: e.source });
  return await next(e);
};

/**
The classic PermissionDenied, a call the mode's classifier refused → `tool.deny` with the head of its reason
*/
const denied: Hook<'classic.PermissionDenied'> = async ($, e, next) => {
  note($, 'tool.deny', {
    agent: e.agent_id,
    id: e.tool_use_id,
    reason: e.reason.slice(0, HEAD),
    tool: e.tool_name,
  });
  return await next(e);
};

/**
The classic Elicitation, an MCP server asking the person, and ElicitationResult (`action` set), their answer →
`elicit`, never the form's content
*/
const elicited: Shared<
  ClassicHookInputs['Elicitation'] | ClassicHookInputs['ElicitationResult']
> = async ($, e, next) => {
  note($, 'elicit', {
    action: field(e, 'action'),
    id: e.elicitation_id,
    mode: e.mode,
    server: e.mcp_server_name,
  });
  return await next(e);
};

/**
`session.end` under the ending id, before `take` and core; the id the feed knew and the senses it reported go with it
*/
const ended: Hook<'session.end'> = async ($, e, next) => {
  await emit($, 'session.end', { reason: e.reason, session: e.sessionId });
  delete feed.session;
  feed.sensed.clear();
  return await next(e);
};

/**
The classic SessionStart, at a start, resume, fork, `/clear` or compaction → `session.open` under the id it names: how
it opened, its title, permission mode, model and agent type, and for a resumed one how long it lay idle and how many
tokens its next request re-sends, and at every opening but a compaction `senses`, the engine's version beside the one the
manifest was surveyed at; the session not held for either
*/
const entered: Hook<'classic.SessionStart'> = async ($, e, next) => {
  void emit($, 'session.open', {
    agentType: e.agent_type,
    idle: e.seconds_since_last_response,
    mode: e.permission_mode,
    model: e.model,
    session: e.session_id,
    source: e.source,
    title: e.session_title,
    tokens: e.context_tokens,
  });
  if (e.source !== 'compact') {
    void sense($, 'senses', { reviewed: senses.version, session: e.session_id });
  }
  return await next(e);
};

/**
The classic StopFailure, an API error ending a turn → `turn.fail` with its class and the head of its details
*/
const failed: Hook<'classic.StopFailure'> = async ($, e, next) => {
  note($, 'turn.fail', {
    agent: e.agent_id,
    details: e.error_details?.slice(0, HEAD),
    error: e.error,
  });
  return await next(e);
};

/**
A usage reading that changed → `usage`: the context's tokens, window and percent, the session's cost, and each
rate-limit window's use and reset
*/
const gauged: Hook<'session.measure'> = async ($, e, next) => {
  const { percent, tokens, window } = e.context;
  const reading = JSON.stringify({
    limits: e.rateLimits,
    percent,
    tokens,
    usd: e.cost?.usd,
    window,
  });
  if (reading !== feed.measured) {
    feed.measured = reading;
    note($, 'usage', JSON.parse(reading));
  }
  return await next(e);
};

/**
The classic TeammateIdle, a teammate gone quiet → `teammate.idle`
*/
const idled: Hook<'classic.TeammateIdle'> = async ($, e, next) => {
  note($, 'teammate.idle', { name: e.teammate_name });
  return await next(e);
};

/**
The person pressing Stop → `stop`, noted before anything awaits, whether a turn was running
*/
const interrupted: Hook<'session.stop'> = async ($, e, next) => {
  note($, 'stop', { running: e.isTurnRunning });
  return await next(e);
};

/**
A copy isolated for an agent or the session → `worktree` once it answered: where, by which system, on which branch and
revision, or the denial
*/
const isolated: Hook<'vcs.isolate'> = async ($, e, next) => {
  const answer = await next(e);
  note($, 'worktree', { agent: e.agentId, for: e.for, name: e.name, ...answer });
  return answer;
};

/**
The classic InstructionsLoaded, a memory or rules file read in → kept for the next end of turn's `tasks`, since a start
loads them in a burst
*/
const loaded: Hook<'classic.InstructionsLoaded'> = async ($, e, next) => {
  feed.loaded.push({
    agent: e.agent_id,
    path: e.file_path,
    reason: e.load_reason,
    type: e.memory_type,
  });
  return await next(e);
};

/**
A path a prompt names after `@` → `mention` once read: how it was attached, or the denial
*/
const mentioned: Hook<'prompt.mention'> = async ($, e, next) => {
  const answer = await next(e);
  note($, 'mention', { agent: e.agentId, attached: answer.type, deny: answer.deny, path: e.path });
  return answer;
};

/**
The classic CwdChanged → `cwd`
*/
const moved: Hook<'classic.CwdChanged'> = async ($, e, next) => {
  note($, 'cwd', { from: e.old_cwd, to: e.new_cwd });
  return await next(e);
};

/**
The classic Notification, the engine calling for the person (a permission, an idle prompt) → `notify` with its head
*/
const notified: Hook<'classic.Notification'> = async ($, e, next) => {
  note($, 'notify', {
    message: e.message.slice(0, HEAD),
    title: e.title,
    type: e.notification_type,
  });
  return await next(e);
};

/**
A prompt that is neither meta nor a background task's notification → `prompt` with its head, where it came from, the
slash command it runs, how many images or documents it carries, the turn it was typed over and whether it was asked to
wait; the prompt not held for it
*/
const prompted: Hook<'prompt.submit'> = async ($, e, next) => {
  if (e.isMeta !== true && e.origin.kind !== 'task-notification') {
    void emit($, 'prompt', {
      attachments: e.attachments?.length,
      command: e.command?.name,
      head: e.text.slice(0, HEAD),
      origin: e.origin.kind,
      turn: e.turnId,
      wait: e.wait,
    });
  }
  return await next(e);
};

/**
A delivery reaching the session → `message.receive` with its origin, its size and the wake it parsed as, never its text;
taken by a hook, the reason
*/
const received: Hook<'session.receive'> = async ($, e, next) => {
  const answer = await next(e);
  note($, 'message.receive', {
    agent: e.agentId,
    chars: e.text.length,
    consumed: answer.consumed,
    origin: e.origin,
    wake: e.event && { kind: e.event.kind, source: e.event.source },
  });
  return answer;
};

/**
A copy given back → `worktree.end` once answered: released, with its note, or kept, with why
*/
const released: Hook<'vcs.release'> = async ($, e, next) => {
  const answer = await next(e);
  note($, 'worktree.end', {
    agent: e.agentId,
    discard: e.isDiscard,
    name: e.name,
    path: e.path,
    reason: e.reason,
    ...answer,
  });
  return answer;
};

/**
An agent's report → `agent.end` with its status and the report's head, the report passed on as `next` answered it
*/
const reported: Hook<'agent.report'> = async ($, e, next) => {
  await emit($, 'agent.end', { agent: e.agentId, report: e.text.slice(0, HEAD), status: e.status });
  return await next(e);
};

/**
A message leaving for another agent or session → `message.send` once answered: to whom, its head, who sent it and
whether it was delivered
*/
const sent: Hook<'session.send'> = async ($, e, next) => {
  const answer = await next(e);
  note($, 'message.send', {
    agent: e.agentId,
    head: e.text.slice(0, HEAD),
    origin: e.origin.kind,
    to: e.to,
    ...answer,
  });
  return answer;
};

/**
Every event (`*` selects no `telemetry.*` one) → `sense.new`, once a session, for a name the manifest lacks (`key` null)
and for each field its event does not offer; synchronous, `e` handed on as it came, so the dispatch waits on nothing
*/
const sensed: AnyEventHook = ($, e, next) => {
  const fields = known.get(next.event);
  const keys = fields ? Object.keys(e as object).filter((key) => !fields.has(key)) : [UNNAMED];
  for (const key of keys) {
    const { size } = feed.sensed;
    if (feed.sensed.add(`${next.event} ${key}`).size > size) {
      void sense($, 'sense.new', { key, name: next.event, source: 'mod' });
    }
  }
  return next(e);
};

/**
A skill's prompt expanded for the model (`/name`, the Skill tool, a preload) → `skill` with whose it is
*/
const skilled: Hook<'skill.prompt'> = async ($, e, next) => {
  note($, 'skill', { plugin: e.pluginName, skill: e.skill, source: e.source });
  return await next(e);
};

/**
A spawn the engine started → `agent.spawn` under the id and model it answered; a denied one, or one answered with no
id, emits nothing
*/
const spawned: Hook<'agent.spawn'> = async ($, e, next) => {
  const answer = await next(e);
  if (answer.agentId !== undefined) {
    const agent = answer.agentId;
    await emit($, 'agent.spawn', {
      agent,
      background: e.background,
      description: e.description,
      fork: e.fork,
      model: answer.model,
      name: e.name,
      parent: e.parentAgentId,
      prompt: e.prompt.slice(0, HEAD),
      teammate: e.isTeammate,
      type: e.subagentType,
      workflow: e.workflow && { index: e.workflow.agentIndex, run: e.workflow.runId },
    });
    await update($, workflows, (ids) => (e.workflow ? [...ids, agent] : ids));
  }
  return answer;
};

/**
`session.start` with where and how the session runs: its repository and working copy when it stands in one, how it was
launched, the engine's version, the platform, the surfaces it draws on and its transcript, each left out where the
engine cannot say
*/
const started: Hook<'session.start'> = async ($, e, next) => {
  const [copy, entrypoint, info, kind, repository, surfaces, version] = await Promise.all([
    quiet($.vcs.detect({ path: e.cwd })),
    quiet($.env.get('CLAUDE_CODE_ENTRYPOINT')),
    quiet($.session.info()),
    quiet($.env.get('CLAUDE_CODE_SESSION_KIND')),
    quiet($.session.repo()),
    quiet($.session.surfaces()),
    quiet($.session.version()),
  ]);
  await emit($, 'session.start', {
    agentType: info?.agentType,
    copy: copy ?? undefined,
    cwd: e.cwd,
    entrypoint,
    hosted: info?.isHosted,
    interactive: e.isInteractive,
    kind,
    model: await $.session.model(),
    platform: info?.platform,
    repo: repository
      ? { name: repository.name, remote: repository.remote, root: repository.root }
      : undefined,
    surface: e.surface,
    surfaces,
    transcript: info?.transcriptPath,
    version: version?.version,
  });
  return await next(e);
};

/**
One model request → `step` once its stream ends, every chunk passed on as it came: the model and effort asked for, the
messages sent, whether it thought, the tools it asked for and the API ran itself, why it stopped and its token usage
*/
const stepped: StreamHook<'turn.step'> = async function* stepped($, e, next) {
  const [stream, kinds] = [next(e), new Set<string>()];
  for await (const chunk of stream) {
    kinds.add(chunk.kind);
    yield chunk;
  }
  const result = await stream.result;
  note($, 'step', {
    agent: e.agentId,
    effort: e.effort,
    index: e.index,
    messages: e.messageCount,
    model: e.model,
    server: result.serverToolUses?.map((use) => use.name),
    stop: result.stopReason,
    thinking: kinds.has('thinking'),
    tools: result.toolUses.map((use) => use.name),
    turn: e.turnId,
    usage: result.usage,
  });
  return result;
};

/**
The classic Stop, each end of a turn → `tasks`: the session's background work still in flight (shells, monitors,
workflows, agents) and the wakeups it has scheduled, as the engine lists them, the turn's effort and permission mode, and
the instruction files loaded since the last
*/
const stopped: Hook<'classic.Stop'> = async ($, e, next) => {
  void emit($, 'tasks', {
    crons: e.session_crons,
    effort: e.effort?.level,
    loaded: feed.loaded.splice(0),
    mode: e.permission_mode,
    tasks: e.background_tasks,
  });
  return await next(e);
};

/**
The classic PostModelSwitch, the session's model changed → `model`, from and to, what was asked and by what
*/
const switched: Hook<'classic.PostModelSwitch'> = async ($, e, next) => {
  note($, 'model', {
    from: e.from_model,
    requested: e.requested_model,
    source: e.source,
    to: e.to_model,
  });
  return await next(e);
};

/**
The classic TaskCreated and TaskCompleted, the team's task list → `todo` with the task's head and teammate
*/
const tasked: Shared<
  ClassicHookInputs['TaskCompleted'] | ClassicHookInputs['TaskCreated']
> = async ($, e, next) => {
  note($, 'todo', {
    done: e.hook_event_name === 'TaskCompleted',
    id: e.task_id,
    subject: e.task_subject.slice(0, HEAD),
    teammate: e.teammate_name,
  });
  return await next(e);
};

/**
A loop's turn ending, with its length, usage and a refusal's category, and with it a workflow agent's run
*/
const turnEnded: Hook<'turn.complete'> = async ($, e, next) => {
  await emit($, 'turn.complete', {
    agent: e.agentId,
    ms: e.durationMs,
    reason: e.reason,
    refusal: field(field(e, 'refusal'), 'category'),
    turn: e.turnId,
    usage: e.usage,
  });
  const running = await read($, workflows);
  if (e.agentId !== undefined && running.includes(e.agentId)) {
    await update($, workflows, (ids) => ids.filter((id) => id !== e.agentId));
    await emit($, 'agent.end', { agent: e.agentId, status: 'completed' });
  }
  return await next(e);
};

/**
A loop's turn starting
*/
const turnStarted: Hook<'turn.start'> = async ($, e, next) => {
  await emit($, 'turn.start', { agent: e.agentId, turn: e.turnId });
  return await next(e);
};

/**
The person editing the prompt box → `typing`, at most one per `TYPING` by the wall clock, which costs no call on `$`;
never the text
*/
const typed: Hook<'prompt.edit'> = async ($, e, next) => {
  const now = Temporal.Now.instant().epochMilliseconds;
  if (now - feed.typed >= TYPING) {
    feed.typed = now;
    note($, 'typing', {});
  }
  return await next(e);
};

export {
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
};
