// End-to-end checks on session.ts against a scratch HOME: stub `ps`, `claude` and `sandman` on a scratch PATH, and a
// `sleep` standing in for each session's CLI. macOS only, where the script runs.
import { expect, test } from 'bun:test';

const POLL_MS = 100;
const QUIET_MS = 800;
const TIMEOUT_MS = 20_000;
const SCRIPT = `${import.meta.dir}/session.ts`;
const [BG = '', FG = '', KEEP = ''] = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map(
  (head) => `${head}-1111-2222-3333-444444444444`,
);
const macos = test.skipIf(process.platform !== 'darwin');

type Run = {
  argv?: string[];
  cli: Bun.Subprocess;
  extra?: Record<string, string>;
  home: string;
  sid: string;
};

/**
A scratch HOME whose stub `ps` prints `$ARGS` for `$CLI` alone, and whose stub `claude` and `sandman` append their argv
to `calls` and exit `$RC`
*/
const rig = async (): Promise<string> => {
  const root = await Bun.$`realpath $(mktemp -d)`.text();
  const home = root.trim();
  const log = 'echo "$(basename "$0") $*" >>"$HOME/calls"; exit "$RC"';
  const ps = '[ "$4" = "$CLI" ] && echo "$ARGS"';
  await Promise.all(
    Object.entries({ claude: log, ps, sandman: log }).map(async ([stub, body]) =>
      Bun.write(`${home}/bin/${stub}`, `#!/bin/sh\n${body}\n`),
    ),
  );
  await Bun.$`chmod 755 ${home}/bin/claude ${home}/bin/ps ${home}/bin/sandman`;
  return home;
};

/**
session.ts run as `sid` on the CLI stand-in `cli`: its exit code and stdout
*/
const end = ({ argv = [], cli, extra = {}, home, sid }: Run): [number, string] => {
  const environment = {
    ARGS: 'claude',
    CLAUDE_CODE_SESSION_ID: sid,
    CLAUDE_CODE_TMPDIR: `${home}/tmp`,
    CLAUDE_PID: String(cli.pid),
    CLI: String(cli.pid),
    HOME: home,
    PATH: `${home}/bin:/usr/bin:/bin`,
    RC: '0',
    ...extra,
  };
  const run = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { env: environment });
  return [run.exitCode, run.stdout.toString()];
};

const read = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : '';
};

const sorted = (items: string[]): string[] =>
  items.toSorted((left, right) => left.localeCompare(right));

const calls = async (home: string): Promise<string[]> => {
  const text = await read(`${home}/calls`);
  return sorted(text.trim().split('\n').filter(Boolean));
};

/**
Resolves once `isDone` holds, polling
*/
const until = async (isDone: () => Promise<boolean>): Promise<void> => {
  if (await isDone()) {
    return;
  }
  await Bun.sleep(POLL_MS);
  await until(isDone);
};

/**
A stand-in's state: running, or how it ended
*/
const state = (cli: Bun.Subprocess): number | string => cli.signalCode ?? cli.exitCode ?? 'running';

const files = (sid: string): string[] => [
  `.claude/debug/${sid}.txt`,
  `.claude/dev-mods/${sid}/x`,
  `.claude/file-history/${sid}/x`,
  `.claude/session-env/${sid}/x`,
  `.claude/tasks/${sid}/x`,
  `.claude/uploads/${sid}/x`,
  `tmp/claude-${process.getuid?.()}/-p/${sid}/tasks/x`,
];

const line = (key: string, sid: string, note = ''): string => JSON.stringify({ [key]: sid, note });

// Refusals exit 1 and close nothing: the daemon and its pty host by subcommand word, a dead pid, a sid that is no UUID.
macos('refuses without a safe identity', async () => {
  const home = await rig();
  const cli = Bun.spawn(['sleep', '60']);
  const runs = [
    end({ cli, extra: { ARGS: '/opt/claude daemon run' }, home, sid: BG }),
    end({ cli, extra: { ARGS: 'claude bg-pty-host 7' }, home, sid: BG }),
    end({ cli, extra: { ARGS: '/x/MacOS/claude --bg-pty-host /tmp/p.sock' }, home, sid: BG }),
    end({ cli, extra: { CLAUDE_PID: '99999999' }, home, sid: BG }),
    end({ cli, home, sid: '../x' }),
  ];
  await Bun.sleep(QUIET_MS);
  expect([runs.map(([code]) => code), state(cli), await calls(home)]).toEqual([
    [1, 1, 1, 1, 1],
    'running',
    [],
  ]);
  cli.kill();
});

// /end interrupts its own CLI and nothing else, run from its versioned path though its prompt holds the word daemon.
macos('ends an interactive session by its pid alone', async () => {
  const home = await rig();
  const [cli, bystander] = [Bun.spawn(['sleep', '60']), Bun.spawn(['sleep', '60'])];
  const ARGS = '/u/.local/share/claude/versions/2.1.332 why does the daemon crash';
  const run = end({ cli, extra: { ARGS }, home, sid: FG });
  await cli.exited;
  expect([run, state(cli), state(bystander), await calls(home)]).toEqual([
    [0, '▸ ending bbbbbbbb\n'],
    'SIGINT',
    'running',
    [],
  ]);
  bystander.kill();
});

// /end on a background job removes it and does nothing more; an erase whose CLI outlives the limit forgets only
// before the close, so its child gives up and a later exit is not forgotten.
macos(
  'removes a background job, and an erase gives up on a CLI that never exits',
  async () => {
    const home = await rig();
    const cli = Bun.spawn(['sleep', '60']);
    const job = { CLAUDE_JOB_DIR: `${home}/.claude/jobs/x`, END_EXIT_LIMIT_MS: String(POLL_MS) };
    const runs = [
      end({ cli, extra: job, home, sid: BG }),
      end({ argv: ['--erase'], cli, extra: job, home, sid: KEEP }),
    ];
    await Bun.sleep(QUIET_MS);
    const running = state(cli);
    cli.kill();
    await Bun.sleep(2 * QUIET_MS);
    expect([runs, running, await calls(home)]).toEqual([
      [
        [0, '▸ ending aaaaaaaa\n'],
        [0, `▸ erased ${KEEP}; the exit is watched\n`],
      ],
      'running',
      ['claude rm aaaaaaaa', 'claude rm cccccccc', `sandman forget ${KEEP}`],
    ]);
  },
  TIMEOUT_MS,
);

// A failed forget closes nothing.
macos('a failed erase closes nothing', async () => {
  const home = await rig();
  const cli = Bun.spawn(['sleep', '60']);
  const [code] = end({ argv: ['--erase'], cli, extra: { RC: '1' }, home, sid: FG });
  await Bun.sleep(QUIET_MS);
  expect([code, state(cli), await calls(home)]).toEqual([2, 'running', [`sandman forget ${FG}`]]);
  cli.kill();
});

// Both erase paths forget before and after the exit and remove exactly their own survivors: a background job is
// removed from the list, an interactive CLI interrupted; KEEP's files and lines, a line merely naming an erased sid and
// an unparsable one stay.
macos(
  'erases a background and an interactive session, nothing else',
  async () => {
    const home = await rig();
    const kept = (key: string): string[] => [
      line(key, KEEP),
      line(key, KEEP, BG),
      `{"${key}":"${FG}"`,
    ];
    const shared = (key: string): string => [line(key, BG), line(key, FG), ...kept(key)].join('\n');
    const logs = ['2026-11-18', '2026-11-19'].map(
      (day) => `.local/state/subether/tools/${day}.jsonl`,
    );
    await Promise.all([
      ...[BG, FG, KEEP]
        .flatMap((sid) => files(sid))
        .map(async (path) => Bun.write(`${home}/${path}`, '')),
      Bun.write(`${home}/.claude/history.jsonl`, shared('sessionId')),
      ...logs.map(async (path) => Bun.write(`${home}/${path}`, shared('session'))),
    ]);
    const [bg, fg] = [Bun.spawn(['sleep', '60']), Bun.spawn(['sleep', '60'])];
    const job = { CLAUDE_JOB_DIR: `${home}/.claude/jobs/aaaaaaaa` };
    const runs = [
      end({ argv: ['--erase'], cli: bg, extra: job, home, sid: BG }),
      end({ argv: ['--erase'], cli: fg, home, sid: FG }),
    ];
    await until(async () => {
      const made = await calls(home);
      return made.includes('claude rm aaaaaaaa');
    });
    bg.kill();
    const want = ['claude rm aaaaaaaa', ...[BG, BG, FG, FG].map((sid) => `sandman forget ${sid}`)];
    await until(async () => {
      const made = await calls(home);
      return made.length === want.length;
    });
    await Bun.sleep(QUIET_MS);
    const found = await Bun.$`cd ${home} && find .claude tmp .local -type f`.text();
    const texts = await Promise.all(
      ['.claude/history.jsonl', ...logs].map(async (path) => read(`${home}/${path}`)),
    );
    expect([runs, state(fg), await calls(home), sorted(found.trim().split('\n')), texts]).toEqual([
      [
        [0, `▸ erased ${BG}; the exit is watched\n`],
        [0, `▸ erased ${FG}; the exit is watched\n`],
      ],
      'SIGINT',
      want,
      sorted([...files(KEEP), '.claude/history.jsonl', ...logs]),
      [kept('sessionId'), kept('session'), kept('session')].map((lines) => lines.join('\n')),
    ]);
  },
  TIMEOUT_MS,
);
