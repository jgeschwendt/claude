import type { On, PromptSubmitInput } from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

const CAP = 10_000;
const NOW = 1_757_000_000_000;
const RECALL = 'recalled: the owner prefers patch bumps';
const reply = (context: string): string =>
  JSON.stringify({
    hookSpecificOutput: { additionalContext: context, hookEventName: 'SessionStart' },
  });

/**
The engine beneath: `sandman` answering `stdout`/`exitCode`, each run's argv and stdin, the context's log lines (the
judge's, run on every composer prompt, left out), and every prompt that reached the bottom
*/
const engine = (
  on: On,
  { exitCode = 0, stdout = reply(RECALL) } = {},
): {
  logs: string[];
  prompts: PromptSubmitInput[];
  runs: { argv: readonly string[]; stdin?: string }[];
} => {
  const logs: string[] = [];
  const prompts: PromptSubmitInput[] = [];
  const runs: { argv: readonly string[]; stdin?: string }[] = [];
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: '/home/test' });
  on('process.run', ($, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin });
    const ran = { exitCode, isStderrTruncated: false, isStdoutTruncated: false };
    return { value: { ...ran, stderr: 'no bank\nmore', stdout } };
  });
  on('prompt.submit', ($, e) => {
    prompts.push(e);
    return { context: e.context, text: e.text };
  });
  on('session.cwd', () => ({ value: '/w' }));
  on('session.id', () => ({ value: 's1' }));
  on('ui.log', ($, e) => {
    logs.push(...(e.text.startsWith('subether judge') ? [] : [e.text]));
    return { value: undefined };
  });
  return { logs, prompts, runs };
};

const submit = async ($: Engine, extra: Partial<PromptSubmitInput> = {}): Promise<void> => {
  await $.prompt.submit({ origin: { kind: 'composer' }, text: 'hi', wait: false, ...extra });
};

test('the first prompt attaches the recall as one context block after what it carried', async ($, on) => {
  const { prompts, runs } = engine(on);
  await submit($, { context: ['earlier'] });
  expect(prompts.map(({ context }) => context)).toEqual([['earlier', RECALL]]);
  expect(runs).toEqual([
    {
      argv: ['/home/test/.local/bin/sandman', 'recall', '--hook'],
      stdin: '{"cwd":"/w","hook_event_name":"SessionStart","session_id":"s1"}',
    },
  ]);
});

test('plain stdout attaches as itself', async ($, on) => {
  const { prompts } = engine(on, { stdout: `${RECALL}\n` });
  await submit($);
  expect(prompts[0]?.context).toEqual([RECALL]);
});

test('later prompts attach nothing and run nothing', async ($, on) => {
  const { prompts, runs } = engine(on);
  await submit($);
  await submit($);
  expect(prompts.map(({ context }) => context)).toEqual([[RECALL], undefined]);
  expect(runs).toHaveLength(1);
});

test('a meta prompt is skipped and does not count as the first', async ($, on) => {
  const { prompts, runs } = engine(on);
  await submit($, { isMeta: true });
  expect(runs).toHaveLength(0);
  await submit($);
  expect(prompts.map(({ context }) => context)).toEqual([undefined, [RECALL]]);
});

test('a recall past the cap is cut at its last line break, named, and logged', async ($, on) => {
  const long = `${'a'.repeat(CAP - 1)}\n${'b'.repeat(CAP)}`;
  const { logs, prompts } = engine(on, { stdout: reply(long) });
  await submit($);
  const reason = `context cap: sandman recall printed ${long.length} chars, cap ${CAP}`;
  expect(prompts[0]?.context).toEqual([`${'a'.repeat(CAP - 1)}\n… [${reason}]`]);
  expect(logs).toEqual([`subether: ${reason}`]);
});

test('a recall past the cap with no line break is cut at the cap', async ($, on) => {
  const { prompts } = engine(on, { stdout: 'c'.repeat(CAP + 1) });
  await submit($);
  expect(prompts[0]?.context?.[0]).toStartWith(`${'c'.repeat(CAP)}… [context cap: `);
});

for (const [name, options, line] of [
  ['a non-zero exit', { exitCode: 2 }, 'Error: exited 2: no bank'],
  ['empty stdout', { stdout: ' \n' }, 'Error: printed nothing'],
  ['an empty reply', { stdout: reply('') }, 'Error: printed nothing'],
] as const) {
  test(`${name} attaches nothing, logs one line, is recorded as failed, and is not retried`, async ($, on) => {
    const { logs, prompts, runs } = engine(on, options);
    const written: unknown[] = [];
    on('state.get', async ($$, e, next) =>
      e.key === 'injected' ? { value: { value: written.at(-1), version: 0 } } : await next(e),
    );
    on('state.set', async ($$, e, next) => {
      written.push(...(e.key === 'injected' ? [e.value] : []));
      return e.key === 'injected' ? { value: { isSet: true, version: 0 } } : await next(e);
    });
    await submit($);
    await submit($);
    const unchanged = { origin: { kind: 'composer' }, text: 'hi', wait: false };
    expect(prompts).toEqual([unchanged, unchanged]);
    expect(logs).toEqual([`subether context: sandman recall: ${line}`]);
    const failed = {
      at: NOW,
      chars: 0,
      cut: false,
      error: line,
      source: 'sandman recall',
      text: '',
    };
    expect(written).toEqual([[failed]]);
    expect(runs).toHaveLength(1);
  });
}
