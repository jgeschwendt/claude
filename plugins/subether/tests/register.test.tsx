import type { On } from 'claude-code';
import { type Engine, expect, test } from 'claude-code/testing';

const SENTINEL = 'beneath';

/**
Each pass-through: the engine's hook, answering with the event it saw, the fire, and the answer's field
*/
const PASS: [string, (on: On) => void, ($: Engine) => Promise<unknown>, string][] = [
  [
    'prompt.submit',
    (on): void => {
      on('prompt.submit', ($, e) => ({ text: JSON.stringify(e) }));
    },
    async ($): Promise<unknown> =>
      await $.prompt.submit({ origin: { kind: 'composer' }, text: SENTINEL, wait: false }),
    'text',
  ],
  [
    'session.start',
    (on): void => {
      on('session.start', ($, e) => ({ cwd: JSON.stringify(e) }));
    },
    async ($): Promise<unknown> =>
      await $.session.start({ cwd: SENTINEL, isInteractive: false, surface: 'terminal' }),
    'cwd',
  ],
  [
    'tool.call Bash',
    (on): void => {
      on('tool.call', ($, e) => ({ result: JSON.stringify(e) }));
    },
    async ($): Promise<unknown> => await $.tool.call({ command: SENTINEL, tool: 'Bash' }),
    'result',
  ],
  [
    'tool.call Write',
    (on): void => {
      on('tool.call', ($, e) => ({ result: JSON.stringify(e) }));
    },
    async ($): Promise<unknown> =>
      await $.tool.call({ content: SENTINEL, file_path: '/w/a.md', tool: 'Write' }),
    'result',
  ],
];

for (const [name, beneath, fire, field] of PASS) {
  test(`${name} passes through`, async ($, on) => {
    beneath(on);
    expect(await fire($)).toMatchObject({ [field]: expect.stringContaining(SENTINEL) });
  });
}
