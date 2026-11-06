// End-to-end checks on the /delete and /dissolve session scripts against a scratch HOME: stub `ps`, `claude` and
// `sandman` on its `.local/bin`, and a `sleep` standing in for this session's CLI. macOS only, like the scripts
// (`stat -f`).
import { expect, test } from 'bun:test';

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const POLL_MS = 100;
const SETTLE_MS = 10_000;
const TIMEOUT_MS = 20_000;
const macos = test.skipIf(process.platform !== 'darwin');
const skills = `${import.meta.dir}/../..`;

type Rig = { cli: Bun.Subprocess; home: string };

/**
The stub `ps` names only the stand-in's pid `claude`, makes it every pid's parent, gives it argv `$ARGS` and no TTY;
the stub `claude` and `sandman` append their argv to `$HOME/calls`
*/
const rig = async (): Promise<Rig> => {
  const root = await Bun.$`realpath $(mktemp -d)`.text();
  const home = root.trim();
  const log = 'echo "$(basename "$0") $*" >>"$HOME/calls"';
  const ps = `case $2 in comm=) [ "$4" = "$CLI" ] && echo /x/claude || echo zsh ;; args=) echo "$ARGS" ;; ppid=) echo " $CLI" ;; tty=) echo '??' ;; esac`;
  const stubs = Object.entries({ claude: log, ps, sandman: log });
  await Promise.all(
    stubs.map(([stub, body]) => Bun.write(`${home}/.local/bin/${stub}`, `#!/bin/sh\n${body}\n`)),
  );
  await Bun.$`chmod 755 ${home}/.local/bin/claude ${home}/.local/bin/ps ${home}/.local/bin/sandman`;
  return { cli: Bun.spawn(['sleep', '60']), home };
};

/**
`<script>-session.sh --watch-only` under the rig's CLI, whose argv is `argv`: its exit code and stdout
*/
const arm = ({ cli, home }: Rig, script: string, argv: string): [number, string] => {
  const environment = {
    ARGS: argv,
    CLAUDE_SESSION_ID: SID,
    CLI: String(cli.pid),
    HOME: home,
    PATH: `${home}/.local/bin:/usr/bin:/bin`,
  };
  const path = `${skills}/${script}/scripts/${script}-session.sh`;
  const run = Bun.spawnSync([path, '--watch-only'], { env: environment });
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
  const runs = ['delete', 'dissolve'].flatMap((script) =>
    cases.map(([argv, code]) => {
      const [got, stdout] = arm(session, script, argv);
      return [
        [script, argv, got, stdout.includes('Could not identify')],
        [script, argv, code, code === 1],
      ];
    }),
  );
  await end(session);
  expect(runs.map(([got]) => got)).toEqual(runs.map(([, want]) => want));
});

// Once the CLI is gone both scripts retire a live job before anything else, delete then erases what regrew, and
// dissolve counts a pointer as the hook's take iff it changed after arming — within the same second too.
macos(
  'endings after the CLI exits',
  async () => {
    const journal = `.sandman/.trace/dissolve-${Temporal.Now.plainDateISO('UTC').toString()}.log`;
    const pointer = `.sandman/memories/.recent/${SID}.json`;
    const job = ['jobs/aaaaaaaa/state.json', `projects/-p/${SID}.jsonl`, `projects/-p/${SID}/x`];
    const cases = [
      ['delete', 'job', 'calls', 'sandman forget', `claude rm aaaaaaaa\nsandman forget ${SID}\n`],
      ['dissolve', 'job', journal, ' took ', `claude rm aaaaaaaa\nsandman take ${SID} --force\n`],
      ['dissolve', 'stale', journal, ' took ', `sandman take ${SID} --force\n`],
      ['dissolve', 'fresh', journal, ' hook-took ', ''],
    ] as const;
    const rigs = await Promise.all(
      cases.map(async ([script, setup]) => {
        const session = await rig();
        const put = (path: string): Promise<number> => Bun.write(`${session.home}/${path}`, '{}');
        const before = { fresh: [], job: job.map((path) => `.claude/${path}`), stale: [pointer] };
        await Promise.all(before[setup].map((path) => put(path)));
        const [code] = arm(session, script, 'claude');
        await (setup === 'fresh' ? put(pointer) : undefined);
        return { code, session };
      }),
    );
    await Promise.all(rigs.map(({ session }) => end(session)));
    const deadline = Date.now() + SETTLE_MS;
    const endings = await Promise.all(
      rigs.map(async ({ code, session: { home } }, index) => {
        const [script, setup, file, needle, calls] = cases[index] ?? cases[0];
        const text = await settle(`${home}/${file}`, needle, deadline);
        const regrew =
          script === 'delete' ? await Bun.$`ls -A ${home}/.claude/projects/-p`.text() : '';
        const got = [setup, code, text.includes(needle), await read(`${home}/calls`), regrew];
        return [got, [setup, 0, true, calls, '']];
      }),
    );
    expect(endings.map(([got]) => got)).toEqual(endings.map(([, want]) => want));
  },
  TIMEOUT_MS,
);
