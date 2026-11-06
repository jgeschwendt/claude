/**
The SessionStart stand-in: no native event injects at session start, so the session's first prompt (and the first
after `/clear`, which resets `$.state`) attaches `sandman recall` as one context block, under perpetual's 10,000 cap
*/
import { type EngineInterface, type Hook, atom, read, update } from 'claude-code';
import { field } from './gauge';

const injected = atom({ key: 'injected', plugin: 'subether' } as const, []);

// perpetual's CAP.SessionStart and HOOK_MS
const CAP = 10_000;
const SOURCE = 'sandman recall' as const;
const TIMEOUT = 10_000;

/**
`sandman recall --hook` on a SessionStart payload of the fields it reads (`cwd`, `session_id`), its reply's
`additionalContext` (or plain stdout); a non-zero exit or nothing printed rejects
*/
const recall = async ($: EngineInterface): Promise<string> => {
  const [cwd, home, id] = await Promise.all([$.session.cwd(), $.env.get('HOME'), $.session.id()]);
  // the wire format, keys sorted
  const stdin = `{"cwd":${JSON.stringify(cwd)},"hook_event_name":"SessionStart","session_id":${JSON.stringify(id)}}`;
  const argv = [`${home ?? ''}/.local/bin/sandman`, 'recall', '--hook'];
  const { exitCode, stderr, stdout } = await $.process.run(argv, { stdin, timeoutMs: TIMEOUT });
  const out = stdout.trim();
  const reply = /^\{[^]*\}$/u.test(out)
    ? field(field(JSON.parse(out), 'hookSpecificOutput'), 'additionalContext')
    : out;
  if (exitCode !== 0 || typeof reply !== 'string' || reply === '') {
    throw new Error(
      exitCode === 0
        ? 'printed nothing'
        : `exited ${exitCode}: ${stderr.trim().replace(/\n[^]*/u, '')}`,
    );
  }
  return reply;
};

/**
`text` within the cap, else its head to the last line break and the cut named. Tried once a session: a failure
attaches nothing and is recorded with its error, for the pane
*/
const context: Hook<'prompt.submit'> = async ($, e, next) => {
  const prior = await read($, injected);
  if (e.isMeta === true || prior.length > 0) {
    return await next(e);
  }
  const at = await $.clock.now();
  const text = await recall($).catch(async (error: unknown) => {
    $.ui.log(`subether context: ${SOURCE}: ${String(error)}`);
    const failed = { at, chars: 0, cut: false, error: String(error), source: SOURCE, text: '' };
    await update($, injected, (was) => [...was, failed]);
    return '';
  });
  $.ui.invalidate('ui.render');
  if (text === '') {
    return await next(e);
  }
  const reason = `context cap: ${SOURCE} printed ${text.length} chars, cap ${CAP}`;
  const isCut = text.length > CAP;
  const kept = isCut
    ? `${text.slice(0, text.lastIndexOf('\n', CAP) + 1 || CAP)}… [${reason}]`
    : text;
  if (isCut) {
    // chunk 4 · trail guard: `sandman trail append --kind guard --rationale <reason>`
    $.ui.log(`subether: ${reason}`);
  }
  await update($, injected, (was) => [
    ...was,
    { at, chars: kept.length, cut: isCut, source: SOURCE, text: kept },
  ]);
  return await next({ ...e, context: [...(e.context ?? []), kept] });
};

export { context };
