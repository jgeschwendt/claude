// End-to-end checks on the /delete session script against a scratch HOME: stub `ps`, `claude` and `sandman-next` on its
// `.local/bin`, and a `sleep` standing in for this session's CLI. macOS only, where the script runs.
import { expect, test } from 'bun:test';

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const POLL_MS = 100;
const SETTLE_MS = 10_000;
const TIMEOUT_MS = 20_000;
const macos = test.skipIf(process.platform !== 'darwin');

type Rig = { cli: Bun.Subprocess; home: string };

/**
The stub `ps` names only the stand-in's pid `claude`, makes it every pid's parent, gives it argv `$ARGS` and no TTY;
the stub `claude` and `sandman-next` append their argv to `$HOME/calls`
*/
const rig = async (): Promise<Rig> => {
  const root = await Bun.$`realpath $(mktemp -d)`.text();
  const home = root.trim();
  const log = 'echo "$(basename "$0") $*" >>"$HOME/calls"';
  const ps = `case $2 in comm=) [ "$4" = "$CLI" ] && echo /x/claude || echo zsh ;; args=) echo "$ARGS" ;; ppid=) echo " $CLI" ;; tty=) echo '??' ;; esac`;
  const stubs = Object.entries({ 'claude': log, ps, 'sandman-next': log });
  await Promise.all(
    stubs.map(([stub, body]) => Bun.write(`${home}/.local/bin/${stub}`, `#!/bin/sh\n${body}\n`)),
  );
  await Bun.$`chmod 755 ${home}/.local/bin/claude ${home}/.local/bin/ps ${home}/.local/bin/sandman-next`;
  return { cli: Bun.spawn(['sleep', '60']), home };
};

/**
`delete-session.sh --watch-only` under the rig's CLI, whose argv is `argv`: its exit code and stdout
*/
const arm = ({ cli, home }: Rig, argv: string): [number, string] => {
  const environment = {
    ARGS: argv,
    CLAUDE_SESSION_ID: SID,
    CLI: String(cli.pid),
    HOME: home,
    PATH: `${home}/.local/bin:/usr/bin:/bin`,
  };
  const run = Bun.spawnSync([`${import.meta.dir}/delete-session.sh`, '--watch-only'], {
    env: environment,
  });
  return [run.exitCode, run.stdout.toString()];
};

const read = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : '';
};

/**
`path`'s text once it holds `needle`, or as it stands at `deadline`
*/
const settle = async (path: string, needle: string, deadline: number): Promise<string> => {
  const text = await read(path);
  if (text.includes(needle) || Date.now() > deadline) {
    return text;
  }
  await Bun.sleep(POLL_MS);
  return settle(path, needle, deadline);
};

const end = ({ cli }: Rig): Promise<number> => {
  cli.kill();
  return cli.exited;
};

// Only the argv word after the executable marks the daemon or its pty host — the same word inside an initial prompt
// is the session — and a refusal exits non-zero, so the skill never reports an ending nothing armed.
macos('refuses only a daemon subcommand', async () => {
  const session = await rig();
  const cases = [
    ['claude why does the daemon crash', 0],
    ['/opt/claude daemon', 1],
    ['claude bg-pty-host 7', 1],
  ] as const;
  const runs = cases.map(([argv, code]) => {
    const [got, stdout] = arm(session, argv);
    return [
      [argv, got, stdout.includes('Could not identify')],
      [argv, code, code === 1],
    ];
  });
  await end(session);
  expect(runs.map(([got]) => got)).toEqual(runs.map(([, want]) => want));
});

// Once the CLI is gone the script retires a live job before anything else, then erases what regrew.
macos(
  'the ending after the CLI exits',
  async () => {
    const session = await rig();
    const { home } = session;
    const job = ['jobs/aaaaaaaa/state.json', `projects/-p/${SID}.jsonl`, `projects/-p/${SID}/x`];
    await Promise.all(job.map((path) => Bun.write(`${home}/.claude/${path}`, '{}')));
    const [code, out] = arm(session, 'claude');
    await end(session);
    const calls = await settle(`${home}/calls`, 'sandman-next forget', Date.now() + SETTLE_MS);
    const regrew = await Bun.$`ls -A ${home}/.claude/projects/-p`.text();
    expect([code, calls, regrew]).toEqual([
      0,
      `claude rm aaaaaaaa\nsandman-next forget ${SID}\n`,
      '',
    ]);
    // the /delete skill reports the erase only on this line
    expect(out).toContain('is erased; the exit flush is watched');
  },
  TIMEOUT_MS,
);
