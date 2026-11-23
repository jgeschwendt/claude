import type {
  AgentReportInput,
  AgentSpawnInput,
  On,
  PromptEditInput,
  PromptSubmitInput,
  SessionCompactInput,
  SessionEndInput,
  SessionMeasureInput,
  ToolCallInput,
  TurnCompleteInput,
  TurnStartInput,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

/**
A typed fixture from JSON, the event's engine-set fields left out
*/
const fixture: <T>(json: string) => T = JSON.parse;
/**
an Explore spawn under a parent the pin leaves alone, `fields` (`,"key":value…`) overriding
*/
const spawn = (fields = ''): AgentSpawnInput =>
  fixture(
    `{"background":true,"description":"d","fork":false,"parentModel":"m","prompt":"p","subagentType":"Explore"${fields}}`,
  );
/**
what every event carries
*/
const base = (event: string): { event: string; session: string } => ({ event, session: 's1' });
/**
the spawn's event as `spawn()` emits it
*/
const SPAWNED = {
  ...base('agent.spawn'),
  agent: 'a1',
  background: true,
  description: 'd',
  fork: false,
  model: 'inherited',
  prompt: 'p',
  type: 'Explore',
};

/**
The engine beneath: `census` (and every other binary) exiting `exitCode`, each event `census emit` was handed, the log,
and core answering each event, a tool call with `answer` once `gate` settled; a spawn described `denied` is refused
*/
const engine = (
  on: On,
  {
    answer = '{"result":"r"}',
    environment = {},
    exitCode = 0,
    gate,
  }: {
    answer?: string;
    environment?: Record<string, string>;
    exitCode?: number;
    gate?: () => Promise<unknown>;
  } = {},
): { emits: unknown[]; logs: string[] } => {
  const [emits, logs]: [unknown[], string[]] = [[], []];
  mock.clock(on, { now: 0 });
  mock.env(on, { ...environment, HOME: '/home/test' });
  on('agent.report', ($, e) => ({ text: e.text }));
  on('agent.spawn', ($, e) =>
    e.description === 'denied' ? { deny: 'no' } : { agentId: 'a1', model: e.model ?? 'inherited' },
  );
  on('process.run', ($, e) => {
    if (e.argv.join(' ') === '/home/test/.local/bin/census emit') {
      emits.push(JSON.parse(e.init?.stdin ?? ''));
    }
    const ran = { exitCode, isStderrTruncated: false, isStdoutTruncated: false, stdout: '' };
    return { value: { ...ran, stderr: 'down' } };
  });
  on('classic.ConfigChange', () => ({}));
  on('classic.CwdChanged', () => ({}));
  on('classic.DirectoryAdded', () => ({}));
  on('classic.Elicitation', () => ({}));
  on('classic.ElicitationResult', () => ({}));
  on('classic.InstructionsLoaded', () => ({}));
  on('classic.Notification', () => ({}));
  on('classic.PermissionDenied', () => ({}));
  on('classic.PermissionRequest', () => ({}));
  on('classic.PostModelSwitch', () => ({}));
  on('classic.SessionStart', () => ({}));
  on('classic.Stop', () => ({}));
  on('classic.StopFailure', () => ({}));
  on('classic.TaskCompleted', () => ({}));
  on('classic.TaskCreated', () => ({}));
  on('classic.TeammateIdle', () => ({}));
  on('command.run', () => ({ text: 'ran' }));
  on('prompt.edit', ($, e) => ({ cursor: e.cursor, text: e.text }));
  on('prompt.mention', () => ({ type: 'file' }));
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.attach', ($, e) => ({ clientId: e.clientId }));
  on('session.compact', ($, e) => ({ messages: e.messages, tokensAfter: 1, tokensBefore: 2 }));
  on('session.cwd', () => ({ value: '/w' }));
  on('session.detach', ($, e) => ({ clientId: e.clientId }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('session.id', () => ({ value: 's1' }));
  on('session.measure', ($, e) => ({ changed: e.changed }));
  on('session.model', () => ({ value: 'm' }));
  on('session.receive', ($, e) => ({ text: e.text }));
  on('session.send', () => ({ isDelivered: true }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.stop', ($, e) => ({ isTurnRunning: e.isTurnRunning }));
  on('skill.prompt', ($, e) => ({ text: e.text }));
  on('tool.call', async () => {
    await gate?.();
    return fixture(answer);
  });
  on('tool.check', () => ({ decision: 'allow' }));
  on('turn.complete', () => ({ text: 'answer' }));
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('vcs.isolate', () => ({ branch: 'b', path: '/c', vcs: 'git' }));
  on('vcs.release', () => ({ isReleased: true }));
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { emits, logs };
};

test('a session start is emitted with where and how it runs', async ($, on) => {
  const { emits } = engine(on);
  expect(await $.session.start({ cwd: '/w', isInteractive: false, surface: 'terminal' })).toEqual({
    cwd: '/w',
  });
  expect(emits).toEqual([
    {
      ...base('session.start'),
      cwd: '/w',
      interactive: false,
      model: 'm',
      surface: 'terminal',
    },
  ]);
});

test('a session end is emitted under the ending id', async ($, on) => {
  const { emits } = engine(on);
  const end = fixture<SessionEndInput>('{"reason":"clear","resume":{"id":"s0"},"sessionId":"s0"}');
  expect(await $.session.end(end)).toEqual({ sessionId: 's0' });
  expect(emits).toEqual([{ ...base('session.end'), reason: 'clear', session: 's0' }]);
});

test('a spawn is emitted under the id and model the engine answered', async ($, on) => {
  const { emits } = engine(on);
  expect(await $.agent.spawn(spawn())).toEqual({ agentId: 'a1', model: 'inherited' });
  expect(emits).toEqual([SPAWNED]);
});

test('the pin still decides, and the event carries its model, parent, name and teammate', async ($, on) => {
  const { emits, logs } = engine(on);
  const fields =
    ',"isTeammate":true,"name":"n","parentAgentId":"a0","parentModel":"claude-fable-5"';
  expect(await $.agent.spawn(spawn(fields))).toEqual({ agentId: 'a1', model: 'opus' });
  expect([emits, logs]).toEqual([
    [{ ...SPAWNED, model: 'opus', name: 'n', parent: 'a0', teammate: true }],
    ['pinned d to opus'],
  ]);
});

test('a denied spawn emits nothing', async ($, on) => {
  const { emits } = engine(on);
  expect(await $.agent.spawn(spawn(',"description":"denied"'))).toEqual({ deny: 'no' });
  expect(emits).toEqual([]);
});

test("an agent's report is its end, passed on unchanged", async ($, on) => {
  const { emits } = engine(on);
  const report = fixture<AgentReportInput>(
    '{"agentId":"a1","status":"failed","subagentType":"Explore","text":"t"}',
  );
  expect(await $.agent.report(report)).toEqual({ text: 't' });
  expect(emits).toEqual([{ ...base('agent.end'), agent: 'a1', report: 't', status: 'failed' }]);
});

test("a loop's turns are emitted, the main conversation's with no agent", async ($, on) => {
  const { emits } = engine(on);
  expect(await $.turn.start(fixture<TurnStartInput>('{"text":"hi","turnId":"t1"}'))).toEqual({
    turnId: 't1',
  });
  await $.turn.complete(
    fixture<TurnCompleteInput>('{"answer":"a","reason":"answer","turnId":"t1"}'),
  );
  expect(emits).toEqual([
    { ...base('turn.start'), turn: 't1' },
    { ...base('turn.complete'), reason: 'answer', turn: 't1' },
  ]);
});

test("a workflow agent's turn ending is its end, once", async ($, on) => {
  const { emits } = engine(on);
  const done = fixture<TurnCompleteInput>(
    '{"agentId":"a1","answer":"a","reason":"answer","turnId":"t2"}',
  );
  await $.agent.spawn(spawn(',"workflow":{"agentIndex":2,"runId":"r1"}'));
  await $.turn.complete(done);
  await $.turn.complete(done);
  const turn = { ...base('turn.complete'), agent: 'a1', reason: 'answer', turn: 't2' };
  expect(emits).toEqual([
    { ...SPAWNED, workflow: { index: 2, run: 'r1' } },
    turn,
    { ...base('agent.end'), agent: 'a1', status: 'completed' },
    turn,
  ]);
});

test('a census that fails is a log line, every answer as core gave it', async ($, on) => {
  const { logs } = engine(on, { exitCode: 1 });
  expect([
    await $.agent.spawn(spawn()),
    await $.turn.start(fixture<TurnStartInput>('{"text":"hi","turnId":"t1"}')),
  ]).toEqual([{ agentId: 'a1', model: 'inherited' }, { turnId: 't1' }]);
  expect(logs).toEqual(['census emit exited 1: down', 'census emit exited 1: down']);
});

/**
the main loop's turn, started and ended: the awaited emits a test's unawaited ones settle between
*/
const START = fixture<TurnStartInput>('{"text":"hi","turnId":"t1"}');
const COMPLETE = fixture<TurnCompleteInput>('{"answer":"a","reason":"answer","turnId":"t1"}');
/**
a five-hour window, as a reading carries it
*/
const LIMITS = '[{"kind":"five_hour","percentUsed":7,"resetsAt":"2026-11-22T20:00:00Z"}]';
const TURN = [
  { ...base('turn.start'), turn: 't1' },
  { ...base('turn.complete'), reason: 'answer', turn: 't1' },
] as const;

test("a turn's tool call is its start and end by target, a permission request mid-call its ask", async ($, on) => {
  const { emits } = engine(on, {
    gate: async () =>
      await $.classic.PermissionRequest(fixture('{"tool_input":{},"tool_name":"Read"}')),
  });
  const call = { id: 'u1', target: '/f', tool: 'Read' };
  await $.turn.start(START);
  await $.tool.call(fixture<ToolCallInput>('{"file_path":"/f","tool":"Read","tool_use_id":"u1"}'));
  await $.turn.complete(COMPLETE);
  expect(emits).toEqual([
    TURN[0],
    { ...base('tool.start'), ...call },
    { ...base('tool.wait'), id: 'u1' },
    { ...base('tool.end'), ...call, outcome: 'ok' },
    TURN[1],
  ]);
});

test('a prompt is emitted by its head and origin, a meta one and a task notification not', async ($, on) => {
  const { emits } = engine(on);
  const prompt = '{"origin":{"kind":"sdk"},"text":"hi","wait":false';
  await $.prompt.submit(fixture<PromptSubmitInput>(`${prompt}}`));
  await $.prompt.submit(fixture<PromptSubmitInput>(`${prompt},"isMeta":true}`));
  await $.prompt.submit(
    fixture<PromptSubmitInput>('{"origin":{"kind":"task-notification"},"text":"n","wait":false}'),
  );
  await $.turn.start(START);
  expect(emits).toEqual([{ ...base('prompt'), head: 'hi', origin: 'sdk', wait: false }, TURN[0]]);
});

test('a usage reading is emitted when it changed, a compaction and its end each time', async ($, on) => {
  const { emits } = engine(on);
  const reading = fixture<SessionMeasureInput>(
    `{"changed":["context"],"context":{"tokens":1,"window":1},"cost":{"usd":1},"rateLimits":${LIMITS}}`,
  );
  await $.turn.start(START);
  await $.session.measure(reading);
  await $.session.measure(reading);
  await $.session.compact(
    fixture<SessionCompactInput>(
      '{"messages":[{"role":"user","text":"m","toolUses":[]}],"trigger":"auto"}',
    ),
  );
  await $.turn.complete(COMPLETE);
  expect(emits).toEqual([
    TURN[0],
    { ...base('usage'), limits: JSON.parse(LIMITS), tokens: 1, usd: 1, window: 1 },
    { ...base('compact'), trigger: 'auto' },
    { ...base('compact.end'), after: 1, before: 2 },
    TURN[1],
  ]);
});

test('before the feed has read a session, a tool call emits nothing', async ($, on) => {
  const { emits } = engine(on);
  await $.tool.call(fixture<ToolCallInput>('{"file_path":"/f","tool":"Read","tool_use_id":"u1"}'));
  await $.turn.start(START);
  expect(emits).toEqual([TURN[0]]);
});

test("a turn's end snapshots the background work in flight and the wakeups scheduled", async ($, on) => {
  const { emits } = engine(on);
  const tasks = '[{"command":"c","description":"d","id":"b1","status":"running","type":"shell"}]';
  await $.classic.Stop(
    fixture(`{"background_tasks":${tasks},"session_crons":[],"stop_hook_active":false}`),
  );
  await $.turn.start(START);
  expect(emits).toEqual([
    { ...base('tasks'), crons: [], loaded: [], tasks: JSON.parse(tasks) },
    TURN[0],
  ]);
});

test('a session start carries its working copy, launch, version, platform, surfaces and transcript', async ($, on) => {
  const { emits } = engine(on, {
    environment: fixture('{"CLAUDE_CODE_ENTRYPOINT":"cli","CLAUDE_CODE_SESSION_KIND":"bg"}'),
  });
  const copy = {
    branch: 'b',
    defaultBranch: 'main',
    mainRoot: '/m',
    remote: 'r',
    revision: 'abc',
    root: '/w',
    vcs: 'git',
  };
  on('session.info', () => ({
    value: { agentType: 'a', isHosted: false, platform: 'macos', transcriptPath: '/t' },
  }));
  on('session.repo', () => ({ value: { internal: true, name: 'o/r', remote: 'r', root: '/m' } }));
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('session.version', () => ({ value: { base: '2.1.330', version: '2.1.330' } }));
  on('vcs.detect', () => copy);
  await $.session.start({ cwd: '/w', isInteractive: true, surface: 'terminal' });
  expect(emits).toEqual([
    {
      ...base('session.start'),
      agentType: 'a',
      copy,
      cwd: '/w',
      entrypoint: 'cli',
      hosted: false,
      interactive: true,
      kind: 'bg',
      model: 'm',
      platform: 'macos',
      repo: { name: 'o/r', remote: 'r', root: '/m' },
      surface: 'terminal',
      surfaces: ['terminal'],
      transcript: '/t',
      version: '2.1.330',
    },
  ]);
});

test('a classic session start is its opening under the id it names, the feed reading its own', async ($, on) => {
  const { emits } = engine(on);
  await $.classic.SessionStart(
    fixture(
      '{"agent_type":"a","context_tokens":9,"model":"m","permission_mode":"plan","seconds_since_last_response":60,"session_id":"s0","session_title":"t","source":"resume"}',
    ),
  );
  await $.turn.start(START);
  expect(emits).toEqual([
    {
      ...base('session.open'),
      ...fixture<object>(
        '{"agentType":"a","idle":60,"mode":"plan","model":"m","session":"s0","source":"resume","title":"t","tokens":9}',
      ),
    },
    { ...base('senses'), reviewed: expect.any(String), session: 's0' },
    TURN[0],
  ]);
});

/**
a request's usage as the API reports it
*/
const USAGE =
  '{"cache_creation_input_tokens":1,"cache_read_input_tokens":2,"input_tokens":3,"model":"m","output_tokens":4}';

test('a model request is its step once the stream ends, every chunk passed on as it came', async ($, on) => {
  const { emits } = engine(on);
  const chunks = fixture<TurnStepChunk[]>(
    '[{"index":0,"kind":"thinking","text":"hm"},{"index":1,"kind":"text","text":"ok"}]',
  );
  on('turn.step', async function* beneath() {
    yield* chunks;
    return fixture<TurnStepResult>(
      `{"answer":"ok","index":0,"serverToolUses":[{"id":"s","input":{},"name":"advisor","startedAt":0}],"stopReason":"tool_use","toolUses":[{"input":{},"name":"Read"}],"turnId":"t1","usage":${USAGE}}`,
    );
  });
  await $.turn.start(START);
  const expected = chunks.values();
  const stream = $.turn.step(
    fixture<TurnStepInput>(
      '{"agentId":"a1","effort":"high","index":0,"messageCount":3,"model":"m","turnId":"t1"}',
    ),
  );
  for await (const chunk of stream) {
    expect(chunk).toEqual(expected.next().value);
  }
  await $.turn.complete(COMPLETE);
  expect([expected.next().done, emits]).toEqual([
    true,
    [
      TURN[0],
      {
        ...base('step'),
        ...fixture<object>(
          `{"agent":"a1","effort":"high","index":0,"messages":3,"model":"m","server":["advisor"],"stop":"tool_use","thinking":true,"tools":["Read"],"turn":"t1","usage":${USAGE}}`,
        ),
      },
      TURN[1],
    ],
  ]);
});

test("a turn's end carries its length, usage and a refusal's category", async ($, on) => {
  const { emits } = engine(on);
  await $.turn.complete(
    fixture<TurnCompleteInput>(
      `{"answer":"","durationMs":5,"isAborted":false,"reason":"refusal","refusal":{"category":"c","explanation":"x"},"turnId":"t1","usage":${USAGE}}`,
    ),
  );
  expect(emits).toEqual([
    {
      ...base('turn.complete'),
      ...fixture<object>(`{"ms":5,"reason":"refusal","refusal":"c","turn":"t1","usage":${USAGE}}`),
    },
  ]);
});

test('a prompt carries its command, attachments, the turn it was typed over and its wait', async ($, on) => {
  const { emits } = engine(on);
  await $.prompt.submit(
    fixture<PromptSubmitInput>(
      '{"attachments":[{"type":"image"}],"command":{"args":"","name":"compact"},"origin":{"kind":"composer"},"text":"/compact","turnId":"t0","wait":true}',
    ),
  );
  await $.turn.start(START);
  expect(emits).toEqual([
    {
      ...base('prompt'),
      attachments: 1,
      command: 'compact',
      head: '/compact',
      origin: 'composer',
      turn: 't0',
      wait: true,
    },
    TURN[0],
  ]);
});

test("a failed tool call ends with its error's head, a read-only one with what the model read counted", async ($, on) => {
  const { emits } = engine(on, {
    answer: '{"isError":true,"isReadOnly":true,"result":"e","text":"boom"}',
  });
  const call = { id: 'u1', target: 'ls', tool: 'Bash' };
  await $.turn.start(START);
  await $.tool.call(fixture<ToolCallInput>('{"command":"ls","tool":"Bash","tool_use_id":"u1"}'));
  await $.turn.complete(COMPLETE);
  expect(emits).toEqual([
    TURN[0],
    { ...base('tool.start'), ...call },
    {
      ...base('tool.end'),
      ...call,
      ...fixture<object>('{"chars":4,"error":"boom","outcome":"error","readOnly":true}'),
    },
    TURN[1],
  ]);
});

test("the classic events a turn raises are each the feed's, instructions kept for the turn's end", async ($, on) => {
  const { emits } = engine(on);
  await $.turn.start(START);
  await $.classic.ConfigChange(fixture('{"file_path":"/s.json","source":"user_settings"}'));
  await $.classic.CwdChanged(fixture('{"new_cwd":"/b","old_cwd":"/a"}'));
  await $.classic.DirectoryAdded(fixture('{"directory":"/d","source":"slash_command"}'));
  await $.classic.Elicitation(
    fixture('{"elicitation_id":"q","mcp_server_name":"srv","message":"m","mode":"form"}'),
  );
  await $.classic.ElicitationResult(
    fixture('{"action":"accept","elicitation_id":"q","mcp_server_name":"srv","mode":"form"}'),
  );
  await $.classic.InstructionsLoaded(
    fixture('{"file_path":"/CLAUDE.md","load_reason":"session_start","memory_type":"User"}'),
  );
  await $.classic.Notification(
    fixture('{"message":"Claude is waiting","notification_type":"idle_prompt","title":"Claude"}'),
  );
  await $.classic.PermissionDenied(
    fixture('{"reason":"r","tool_input":{},"tool_name":"Bash","tool_use_id":"u1"}'),
  );
  await $.classic.PostModelSwitch(
    fixture(
      '{"cache_ttl":"5m","context_tokens":0,"estimated_cache_write_usd":0,"from_model":"a","pricing":"catalog","prompt_cache_warm":false,"requested_model":"opus","source":"command","to_model":"b"}',
    ),
  );
  await $.classic.StopFailure(fixture('{"error":"rate_limit","error_details":"429"}'));
  await $.classic.StopFailure(fixture('{"error":"overloaded"}'));
  await $.classic.TaskCreated(fixture('{"task_id":"k","task_subject":"do","teammate_name":"tm"}'));
  await $.classic.TaskCompleted(
    fixture('{"hook_event_name":"TaskCompleted","task_id":"k","task_subject":"do"}'),
  );
  await $.classic.TeammateIdle(fixture('{"team_name":"t","teammate_name":"tm"}'));
  await $.classic.Stop(
    fixture('{"effort":{"level":"high"},"permission_mode":"auto","stop_hook_active":false}'),
  );
  await $.turn.complete(COMPLETE);
  expect(emits).toEqual([
    TURN[0],
    { ...base('config'), path: '/s.json', source: 'user_settings' },
    { ...base('cwd'), from: '/a', to: '/b' },
    { ...base('directory'), path: '/d', source: 'slash_command' },
    { ...base('elicit'), id: 'q', mode: 'form', server: 'srv' },
    { ...base('elicit'), action: 'accept', id: 'q', mode: 'form', server: 'srv' },
    { ...base('notify'), message: 'Claude is waiting', title: 'Claude', type: 'idle_prompt' },
    { ...base('tool.deny'), id: 'u1', reason: 'r', tool: 'Bash' },
    { ...base('model'), from: 'a', requested: 'opus', source: 'command', to: 'b' },
    { ...base('turn.fail'), details: '429', error: 'rate_limit' },
    { ...base('turn.fail'), error: 'overloaded' },
    { ...base('todo'), done: false, id: 'k', subject: 'do', teammate: 'tm' },
    { ...base('todo'), done: true, id: 'k', subject: 'do' },
    { ...base('teammate.idle'), name: 'tm' },
    {
      ...base('tasks'),
      effort: 'high',
      loaded: [{ path: '/CLAUDE.md', reason: 'session_start', type: 'User' }],
      mode: 'auto',
    },
    TURN[1],
  ]);
});

/**
a phone's screen, in cells
*/
const VIEWPORT = '{"columns":40,"rows":20}';
/**
`$.prompt.edit`, which the kit raises and its typings leave off the test's `$`
*/
const typing = async ($: Engine, edit: PromptEditInput): Promise<unknown> => {
  const raise: (e: PromptEditInput) => Promise<unknown> = Reflect.get($.prompt, 'edit');
  return await raise(edit);
};

test('clients, commands, skills, mentions, messages, worktrees, a Stop and typing are each emitted', async ($, on) => {
  const { emits } = engine(on);
  const edit = fixture<PromptEditInput>(
    '{"cursor":0,"end":0,"inputText":"h","origin":{"kind":"composer"},"start":0,"text":""}',
  );
  await $.turn.start(START);
  await $.session.attach(fixture(`{"clientId":"phone","surface":"mobile","viewport":${VIEWPORT}}`));
  await $.command.run(
    fixture('{"args":"secret","command":"model","origin":{"kind":"composer"},"presentation":{}}'),
  );
  await $.skill.prompt(
    fixture('{"frontmatter":{},"pluginName":"p","skill":"commit","source":"plugin","text":"t"}'),
  );
  await $.prompt.mention(fixture('{"mention":"a.md","path":"/w/a.md"}'));
  await $.session.send(fixture('{"origin":{"kind":"model"},"text":"hello","to":"tm"}'));
  await $.session.receive(
    fixture(
      '{"event":{"data":{"x":1},"kind":"pull_request.closed","source":"github","untrustedKeys":[]},"origin":{"kind":"peer","teammate":"tm","isVerified":true},"text":"hi there"}',
    ),
  );
  await $.session.receive(fixture('{"origin":{"kind":"bridge"},"text":"x"}'));
  await $.vcs.isolate(
    fixture('{"agentId":"a1","base":"head","for":"agent","from":"/w","name":"n"}'),
  );
  await $.vcs.release(
    fixture(
      '{"agentId":"a1","isDiscard":false,"name":"n","path":"/c","reason":"done","vcs":"git"}',
    ),
  );
  await $.session.stop({ isTurnRunning: true });
  await typing($, edit);
  await typing($, edit);
  await $.session.detach(fixture('{"clientId":"phone","reason":"detach","surface":"mobile"}'));
  await $.turn.complete(COMPLETE);
  expect(emits).toEqual([
    TURN[0],
    { ...base('client'), client: 'phone', surface: 'mobile', viewport: JSON.parse(VIEWPORT) },
    { ...base('command'), command: 'model', origin: 'composer' },
    { ...base('skill'), plugin: 'p', skill: 'commit', source: 'plugin' },
    { ...base('mention'), attached: 'file', path: '/w/a.md' },
    { ...base('message.send'), head: 'hello', isDelivered: true, origin: 'model', to: 'tm' },
    {
      ...base('message.receive'),
      chars: 'hi there'.length,
      origin: { isVerified: true, kind: 'peer', teammate: 'tm' },
      wake: { kind: 'pull_request.closed', source: 'github' },
    },
    { ...base('message.receive'), chars: 'x'.length, origin: { kind: 'bridge' } },
    {
      ...base('worktree'),
      agent: 'a1',
      branch: 'b',
      for: 'agent',
      name: 'n',
      path: '/c',
      vcs: 'git',
    },
    {
      ...base('worktree.end'),
      agent: 'a1',
      discard: false,
      isReleased: true,
      name: 'n',
      path: '/c',
      reason: 'done',
    },
    { ...base('stop'), running: true },
    base('typing'),
    { ...base('client'), client: 'phone', reason: 'detach', surface: 'mobile' },
    TURN[1],
  ]);
});

/**
the events a test's emits hold of `name`
*/
const only = (emits: unknown[], name: string): unknown[] =>
  emits.filter((emit) => (emit as { event: string }).event === name);

test("a field the manifest lacks is a `sense.new` once a session, the engine's version beside it", async ($, on) => {
  const { emits } = engine(on);
  on('session.version', () => ({ value: { base: '9.9.9', version: '9.9.9' } }));
  const done = fixture<TurnCompleteInput>(
    '{"answer":"a","novel":1,"reason":"answer","turnId":"t1"}',
  );
  await $.turn.complete(done);
  await $.turn.complete(done);
  await $.session.end(fixture<SessionEndInput>('{"reason":"clear","sessionId":"s1"}'));
  await $.turn.complete(done);
  const novel = {
    ...base('sense.new'),
    engine: '9.9.9',
    key: 'novel',
    name: 'turn.complete',
    source: 'mod',
  };
  expect(emits).toEqual([
    novel,
    TURN[1],
    TURN[1],
    { ...base('session.end'), reason: 'clear' },
    novel,
    TURN[1],
  ]);
});

/**
a plugin adding the noun `probe`, whose `ping` the manifest has never heard of, and pinging it at each `vcs.status`
*/
const PROBE = {
  name: 'probe',
  register: (on: On): void => {
    on('engine.create', async ($, e, next) => ({
      ...(await next(e)),
      probe: { ping: async (): Promise<number> => await Promise.resolve(1) },
    }));
    on('vcs.status', async ($) => {
      await ($ as unknown as { probe: { ping: () => Promise<number> } }).probe.ping();
      return { changes: [], unpublished: 0 };
    });
  },
};

test(
  "a name the manifest lacks is a `sense.new` keyed null; a tool's arguments, a call on `$` and a reviewed undeclared field never are",
  { plugins: [PROBE] },
  async ($, on) => {
    const { emits } = engine(on);
    await $.tool.call(
      fixture<ToolCallInput>('{"file_path":"/f","tool":"Read","tool_use_id":"u9"}'),
    );
    await $.vcs.status({ path: '/w' });
    await $.classic.CwdChanged(fixture('{"new_cwd":"/b","old_cwd":"/a","scratchpad_dir":"/s"}'));
    await $.turn.start(START);
    expect(only(emits, 'sense.new')).toEqual([
      {
        ...base('sense.new'),
        ...fixture<object>('{"key":null,"name":"probe.ping","source":"mod"}'),
      },
    ]);
  },
);

test('a compaction reopens the session with no `senses`', async ($, on) => {
  const { emits } = engine(on);
  await $.classic.SessionStart(fixture('{"session_id":"s0","source":"compact"}'));
  await $.turn.start(START);
  expect(emits).toEqual([{ ...base('session.open'), session: 's0', source: 'compact' }, TURN[0]]);
});
