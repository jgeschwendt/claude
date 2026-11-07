import type { On, SessionEndInput } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

const TAKE = 1500;

/**
A typed fixture from JSON
*/
const fixture: <T>(json: string) => T = JSON.parse;
const end = (reason: string): SessionEndInput =>
  fixture(`{"reason":"${reason}","resume":{"id":"s1"},"sessionId":"s1"}`);

/**
The engine beneath: `sandman` exiting `exitCode`, each run, the log, each end that reached core; `cwd` denied when
`isDenied`
*/
const engine = (
  on: On,
  { exitCode = 0, isDenied = false } = {},
): {
  ends: SessionEndInput[];
  logs: string[];
  runs: { argv: readonly string[]; stdin?: string; timeoutMs?: number }[];
} => {
  const [ends, logs]: [SessionEndInput[], string[]] = [[], []];
  const runs: { argv: readonly string[]; stdin?: string; timeoutMs?: number }[] = [];
  mock.env(on, { HOME: '/home/test' });
  on('process.run', ($, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs });
    const ran = { exitCode, isStderrTruncated: false, isStdoutTruncated: false, stdout: '' };
    return { value: { ...ran, stderr: 'no such session\nmore' } };
  });
  on('session.cwd', () => (isDenied ? { deny: 'gone' } : { value: '/w' }));
  on('session.end', ($, e) => {
    ends.push(e);
    return { sessionId: e.sessionId };
  });
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { ends, logs, runs };
};

for (const reason of ['clear', 'logout', 'other', 'prompt_input_exit', 'resume']) {
  test(`${reason}: sandman take --hook on the SessionEnd payload, 1.5 s, then core with the end unchanged`, async ($, on) => {
    const { ends, logs, runs } = engine(on);
    expect(await $.session.end(end(reason))).toEqual({ sessionId: 's1' });
    expect(runs).toEqual([
      {
        argv: ['/home/test/.local/bin/sandman', 'take', '--hook'],
        stdin: `{"cwd":"/w","hook_event_name":"SessionEnd","reason":"${reason}","session_id":"s1"}`,
        timeoutMs: TAKE,
      },
    ]);
    expect([ends, logs]).toEqual([[end(reason)], []]);
  });
}

test('a take that fails is one log line, and core still ends the session', async ($, on) => {
  const { ends, logs } = engine(on, { exitCode: 1 });
  await $.session.end(end('other'));
  expect([ends, logs]).toEqual([[end('other')], ['sandman take --hook exited 1: no such session']]);
});

test('a take that throws passes the end on', async ($, on) => {
  const { ends, runs } = engine(on, { isDenied: true });
  await $.session.end(end('other'));
  expect([ends, runs]).toEqual([[end('other')], []]);
});
