/**
The recall's two entries (contract: the sandman repo's AGENTS.md `### sandman recall`). The seed: a session's first
prompt, and the first under a new id (after `/clear`), runs `sandman recall`, which writes the session's start mark
and prints the instructions, the due work, the always-set and the prompt's ranked lines, attached as one context block under
perpetual's 10,000 cap. The pull: each recall the agent runs, by Bash or MCP, kept beside it for the pane
*/
import { type EngineInterface, type Hook, type MatchedHook, atom, read, update } from 'claude-code';

const recalls = atom({ key: 'recalls', plugin: 'subether' } as const, []);

/**
the `e.origin.kind`s that carry an ask (PromptOrigin, a closed set): the person's at the terminal, through Remote Control
or Slack, a headless host's turn, a scheduled prompt and a coordinator's hand-off; never a task notification, a peer's or
a channel's message, an observer's, a plugin's, an auto-continuation nor an unclassified one
*/
const ASK = new Set([
  'bridge',
  'composer',
  'coordinator',
  'scheduled-trigger',
  'sdk',
  'slack-ping',
]);
/**
perpetual's CAP.SessionStart: a guard, since the seed prints within 9,000
*/
const CAP = 10_000;
/**
a Bash command that pulls
*/
const PULL = /\bsandman(?:-next)? recall\b/u;
/**
the seed bounds itself at 4 s; 5 s covers its start
*/
const TIMEOUT = 5000;

/**
`sandman recall` on the seed's stdin: `interactive` and `surface` as `session.start` reads them (a terminal under the REPL; `$.session.surfaces()[0]`, left out where nothing draws), so the start mark it writes keeps both. A non-zero exit rejects
*/
const seed = async (
  $: EngineInterface,
  prompt: string,
): Promise<{ stderr: string; stdout: string }> => {
  const [cwd, home, session, surfaces] = await Promise.all([
    $.session.cwd(),
    $.env.get('HOME'),
    $.session.id(),
    $.session.surfaces(),
  ]);
  const stdin = JSON.stringify({
    cwd,
    interactive: surfaces.includes('terminal'),
    prompt,
    session,
    surface: surfaces[0],
  });
  const argv = [`${home ?? ''}/.local/bin/sandman`, 'recall'];
  const { exitCode, stderr, stdout } = await $.process.run(argv, { stdin, timeoutMs: TIMEOUT });
  if (exitCode !== 0) {
    throw new Error(`exited ${exitCode}: ${stderr.trim().split('\n', 1)[0] ?? ''}`);
  }
  return { stderr, stdout };
};

/**
Seeds once per session id on a prompt that carries an ask (`ASK`), a meta prompt skipped; any other prompt passes and leaves the slot for the next: the stdout within the cap, else its head to the last line break and the cut named. A failure attaches nothing and is recorded with its error; nothing printed attaches nothing
*/
const context: Hook<'prompt.submit'> = async ($, e, next) => {
  const [id, prior] = await Promise.all([$.session.id(), read($, recalls)]);
  if (
    e.isMeta === true ||
    !ASK.has(e.origin.kind) ||
    prior.some(({ session, who }) => who === 'seed' && session === id)
  ) {
    return await next(e);
  }
  const { stdout, ...ran } = await seed($, e.text).catch((error: unknown) => {
    $.ui.log(`context: sandman recall: ${String(error)}`);
    return { error: String(error), stdout: '' };
  });
  const text = stdout.trim();
  const reason = `context cap: sandman recall printed ${text.length} chars, cap ${CAP}`;
  const isCut = text.length > CAP;
  const kept = isCut
    ? `${text.slice(0, text.lastIndexOf('\n', CAP) + 1 || CAP)}… [${reason}]`
    : text;
  if (isCut) {
    // chunk 4 · a guard mark: `sandman mark` on `{"kind":"guard","rationale":<reason>,…}`
    $.ui.log(reason);
  }
  const at = await $.clock.now();
  await update($, recalls, (was) => [
    ...was,
    { ...ran, at, session: id, text: kept, who: 'seed' as const },
  ]);
  return await next(kept === '' ? e : { ...e, context: [...(e.context ?? []), kept] });
};

/**
A pull: a Bash `sandman recall` or the MCP `recall`, kept once its result carries a recall header; the result
passes on as it came
*/
const pull: MatchedHook<'tool.call', { tool: RegExp }> = async ($, e, next) => {
  const result = await next(e);
  const text = result.text ?? '';
  if ((e.tool !== 'Bash' || PULL.test(e.command)) && /^recall · /mu.test(text)) {
    const [at, session] = await Promise.all([$.clock.now(), $.session.id()]);
    await update($, recalls, (was) => [...was, { at, session, text, who: 'agent' as const }]);
  }
  return result;
};

export { context, pull };
