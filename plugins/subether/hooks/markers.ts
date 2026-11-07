/**
Judged markers: each prompt the person typed is judged by a System One model (`judge.ts`) for four markers; each judgment is a `prompt` line in the daily tool log, each marker judged at 0.8 or more a `correction` trail event. The judging runs after the prompt entered, never holding it
*/
import { type EngineInterface, type MatchedHook, atom, read, update } from 'claude-code';
import { judge } from './judge';
import { append, object, trail } from './sandman';

type Verdict = NonNullable<Awaited<ReturnType<typeof judge>>>;

const judged = atom({ key: 'judged', plugin: 'subether' } as const, []);
const opened = atom({ key: 'opened', plugin: 'subether' } as const, false);
const prompts = atom({ key: 'prompts', plugin: 'subether' } as const, []);

/**
how much of the prompt a rationale, a pane row and the earlier prompts carry
*/
const HEAD = 200;
/**
the judged prompts the pane keeps
*/
const JUDGED_KEPT = 20;
/**
how much of the prompt, newlines as spaces, its tool log line carries
*/
const LINE = 120;
/**
a prompt past this is a pasted brief or document, not the person's live words
*/
const LONG = 400;
/**
the earlier prompts the repeat question reads
*/
const PROMPTS_KEPT = 3;
/**
how much of the previous answer the correction question reads, from its end
*/
const TAIL = 600;
/**
the yes-probability a marker is trailed at
*/
const THRESHOLD = 0.8;

/**
The four questions, `noul` each (a yes-probability), pointed at the state's fields by name
*/
const QUESTIONS = {
  approval: {
    criteria: {
      false: 'A correction, a question, or a new request',
      true: 'Approval to proceed with what the assistant proposed or is doing',
    },
    instructions: 'Is `prompt` telling the assistant to go ahead?',
    type: 'noul',
  },
  correction: {
    criteria: {
      false: 'A new request, a question, or approval',
      true: 'It says the assistant got something wrong, did the wrong thing, or must undo or redo it',
    },
    instructions:
      'Is `prompt` correcting what the assistant just did or said in `previous answer`?',
    type: 'noul',
  },
  preference: {
    criteria: {
      false: 'A one-off request about the current task',
      true: 'A standing rule: always, never, from now on, prefer one way over another',
    },
    instructions:
      'Does `prompt` state a durable preference or rule for how work should be done from now on?',
    type: 'noul',
  },
  repeat: {
    criteria: {
      false: 'A new instruction, or one not in `earlier prompts`',
      true: 'An instruction from `earlier prompts` given again, reworded or not',
    },
    instructions: 'Is `prompt` restating an instruction already given in `earlier prompts`?',
    type: 'noul',
  },
} as const;

/**
each marker's rationale prefix before the prompt's head
*/
const PREFIX: Record<keyof typeof QUESTIONS, string> = {
  approval: 'approval: ',
  correction: '',
  preference: 'preference: ',
  repeat: 'repeated instruction: ',
};

/**
The tail of the newest assistant message with text; undefined when there is none
*/
const previousAnswer = async ($: EngineInterface): Promise<string | undefined> => {
  const messages = await $.session.messages();
  return messages
    .findLast(({ role, text }) => role === 'assistant' && text !== '')
    ?.text.slice(-TAIL);
};

/**
What a judgment leaves behind: one `prompt` line appended to the daily tool log, unawaited (a failure one dim log line),
keys in the wire order: kind, at, session, head (the prompt's first 120 characters, newlines as spaces), judge, markers,
trailed (those at the threshold, in `PREFIX`'s order), tokens (`null` from Kev), ms (the judging's latency); and each
marker at the threshold trailed as a `correction` event, the prompt's head behind the marker's prefix, the probability
and the judge after it
*/
const settled = async (
  $: EngineInterface,
  judging: { at: number; text: string },
  verdict: Verdict,
): Promise<void> => {
  const { at, text } = judging;
  const over = Object.entries(PREFIX).filter(([name]) => (verdict.markers[name] ?? 0) >= THRESHOLD);
  const [now, session] = await Promise.all([$.clock.now(), $.session.id()]);
  const iso = Temporal.Instant.fromEpochMilliseconds(at).toString({ smallestUnit: 'millisecond' });
  const line = object([
    ['kind', '"prompt"'],
    ['at', JSON.stringify(iso)],
    ['session', JSON.stringify(session)],
    ['head', JSON.stringify(text.replaceAll(/[\r\n]+/gu, ' ').slice(0, LINE))],
    ['judge', JSON.stringify(verdict.judge)],
    ['markers', JSON.stringify(verdict.markers)],
    ['trailed', JSON.stringify(over.map(([name]) => name))],
    ['tokens', JSON.stringify(verdict.tokens)],
    ['ms', String(now - at)],
  ]);
  append($, at, `${line}\n`).catch((error: unknown) => {
    $.ui.log(`prompt log: ${String(error)}`);
  });
  const head = text.slice(0, HEAD);
  await Promise.all(
    over.map(async ([name, prefix]) => {
      const odds = (verdict.markers[name] ?? 0).toFixed(2);
      await trail($, 'correction', `${prefix}${head} (p=${odds}, ${verdict.judge})`);
    }),
  );
};

/**
Judges one composer prompt, records it for the pane, logs and trails it (`settled`). Skipped, and kept out of the earlier prompts: a prompt over 400 characters, one starting `# `, and a `claude --bg` session's opening prompt (dispatch's brief)
*/
const judging = async ($: EngineInterface, text: string): Promise<void> => {
  const isOpening = !(await read($, opened));
  await update($, opened, () => true);
  const isBrief = text.length > LONG || text.startsWith('# ');
  if (isBrief || (isOpening && (await $.env.get('CLAUDE_CODE_SESSION_KIND')) === 'bg')) {
    return;
  }
  const head = text.slice(0, HEAD);
  const [at, earlier, previous] = await Promise.all([
    $.clock.now(),
    read($, prompts),
    previousAnswer($),
  ]);
  await update($, prompts, (was) => [...was, head].slice(-PROMPTS_KEPT));
  const state = {
    ...(previous !== undefined && { 'previous answer': previous }),
    'earlier prompts': earlier,
    'prompt': text,
  };
  const verdict = await judge($, state, QUESTIONS);
  await update($, judged, (was) =>
    [...was, { at, head, markers: {}, ...verdict }].slice(-JUDGED_KEPT),
  );
  $.ui.invalidate('ui.render');
  await (verdict === undefined ? undefined : settled($, { at, text }, verdict));
};

/**
A composer prompt goes on unchanged; once it entered, it is judged unawaited, a failure one dim log line. A meta prompt, a slash command and a dropped prompt are not judged
*/
const markers: MatchedHook<'prompt.submit', { origin: { kind: 'composer' } }> = async (
  $,
  e,
  next,
) => {
  const result = await next(e);
  if (e.isMeta !== true && e.command === undefined && result.drop === undefined) {
    judging($, e.text).catch((error: unknown) => {
      $.ui.log(`judge: ${String(error)}`);
    });
  }
  return result;
};

export { markers };
