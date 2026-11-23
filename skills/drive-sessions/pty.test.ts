// End-to-end checks on pty.ts against fake.ts, a stand-in for `claude agents`, each holder on a scratch socket.
// macOS only, where the script runs.
import { expect, test } from 'bun:test';

const POLL_MS = 100;
const TIMEOUT_MS = 30_000;
const FAKE = `${import.meta.dir}/fake.ts`;
const SCRIPT = `${import.meta.dir}/pty.ts`;
const OK = [0, '', ''];
const fs = process.getBuiltinModule('node:fs');
const { HOME: home, PATH: path } = process.env;
const plain = { PATH: path };
const macos = test.skipIf(process.platform !== 'darwin');

const scratch = async (): Promise<string> => {
  const made = await Bun.$`realpath $(mktemp -d)`.text();
  return made.trim();
};

/**
pty.ts run with `argv`: its exit code, stdout and stderr
*/
const pty = async (
  variables: Record<string, string | undefined>,
  ...argv: string[]
): Promise<(number | string)[]> => {
  const run = Bun.spawn([process.execPath, SCRIPT, ...argv], { env: variables, stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([run.stdout.text(), run.stderr.text()]);
  return [await run.exited, stdout, stderr];
};
const fake = (lapse: string, max: string, ...names: string[]): string[] => [
  '--',
  process.execPath,
  FAKE,
  lapse,
  max,
  ...names,
];
const mode = async (file: string): Promise<string> => {
  const bits = await Bun.$`stat -f %Lp ${file}`.text();
  return bits.trim();
};

/**
The fake's pid and the holder's, from the fake's first line once it shows
*/
const pids = async (sock: string): Promise<number[]> => {
  const [, screen] = await pty(plain, 'screen', `--sock=${sock}`);
  const [, ...held] = String(screen).split('\n', 1)[0]?.split(' ') ?? [];
  if (held.length > 0) {
    return held.map(Number);
  }
  await Bun.sleep(POLL_MS);
  return pids(sock);
};
const isAlive = (pid: number): boolean => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};

/**
Resolves once the socket is gone and none of `held` runs
*/
const cleared = async (sock: string, held: number[]): Promise<void> => {
  if (!fs.existsSync(sock) && held.every((pid) => !isAlive(pid))) {
    return;
  }
  await Bun.sleep(POLL_MS);
  await cleared(sock, held);
};

macos(
  'drives the list: open, select both ways, remove, rename, send, screen, close',
  async () => {
    const directory = await scratch();
    const sock = `${directory}/p.sock`;
    const flag = `--sock=${sock}`;
    const fixture = fake('1000', '9', 'alpha', 'beta', 'gamma');
    const runs = [
      await pty(plain, 'open', flag, '--rows=8', ...fixture),
      await pty(plain, 'select', flag, 'gam'),
      await pty(plain, 'select', flag, 'alp'),
      await pty(plain, 'remove', flag, 'beta'),
      await pty(plain, 'rename', flag, 'gam', 'delta'),
      await pty(plain, 'send', flag, String.raw`\x12`),
      await pty(plain, 'send', flag, String.raw`\x15`),
      await pty(plain, 'send', flag, String.raw`a\\b`),
      await pty(plain, 'send', flag, String.raw`\r`),
      [await mode(sock)],
    ];
    const held = await pids(sock);
    const [, screen] = await pty(plain, 'screen', flag);
    runs.push([String(screen).replaceAll(/ +/gu, ' ')], await pty(plain, 'close', flag));
    await cleared(sock, held);
    expect(runs).toEqual([
      [0, `${sock}\n`, ''],
      [0, 'gamma\n', ''],
      [0, 'alpha\n', ''],
      [0, 'removed beta\n', ''],
      [0, 'renamed gamma → delta\n', ''],
      OK,
      OK,
      OK,
      OK,
      ['600'],
      [
        `pid ${held.join(' ')}\n · alpha stopped\n❯ · a\\b stopped\n\n❯ describe a task for a new session\nctrl+x to remove\n\n\n`,
      ],
      OK,
    ]);
  },
  TIMEOUT_MS,
);

// A lapse of 0 refuses every second ctrl+x, a field of 3 characters truncates a longer name, a listed name is refused.
macos(
  'reports what it cannot do or verify, exit 1',
  async () => {
    const directory = await scratch();
    const sock = `${directory}/p.sock`;
    const flag = `--sock=${sock}`;
    await pty(plain, 'open', flag, ...fake('0', '3', 'ab', 'cd'));
    const held = await pids(sock);
    const runs = [
      await pty(plain, 'open', flag),
      await pty(plain, 'select', flag, 'zz'),
      await pty(plain, 'remove', flag, 'ab'),
      await pty(plain, 'rename', flag, 'ab', 'long'),
      await pty(plain, 'rename', flag, 'ab', 'cd'),
      await pty(plain, 'nonsense', flag),
      await pty(plain, 'remove', flag),
    ];
    await pty(plain, 'close', flag);
    await cleared(sock, held);
    runs.push(
      await pty(plain, 'screen', flag),
      await pty(plain, 'open', flag, '--', `${directory}/none`),
    );
    const usage = 'usage: pty.ts open|screen|send|select|remove|rename|close [--sock <path>] …\n';
    expect(runs).toEqual([
      [1, '', `a holder already answers on ${sock}\n`],
      [1, '', "no row's name starts with zz\n"],
      [1, '', 'ab is still listed: the confirm lapsed or was refused\n'],
      [1, '', 'the field does not read long\n'],
      [1, '', 'cd was not saved\n'],
      [1, '', usage],
      [1, '', usage],
      [1, '', `no holder answers on ${sock}\n`],
      [1, '', `no holder answered on ${sock}\n`],
    ]);
  },
  TIMEOUT_MS,
);

// With no --sock the socket is the job's, else one in a private directory under TMPDIR; with no argv, `claude agents`,
// here a stub running the fake with no rename field.
macos(
  'defaults the socket and the TUI',
  async () => {
    const directory = await scratch();
    const stub = `${directory}/bin/claude`;
    await Bun.write(stub, `#!/bin/sh\nexec ${fake('0', '0').slice(1).join(' ')} "$@"\n`);
    await Bun.$`chmod +x ${stub}`;
    const temporary = { HOME: home, PATH: `${directory}/bin:${path}`, TMPDIR: directory };
    const job = { ...temporary, CLAUDE_JOB_DIR: `${directory}/job` };
    const socks = [
      `${directory}/job/tmp/drive-sessions.sock`,
      `${directory}/drive-sessions/pty.sock`,
    ];
    const runs = [
      await pty(job, 'open'),
      await pty(temporary, 'open'),
      await pty(job, 'rename', 'agents', 'x'),
      [await mode(`${directory}/drive-sessions`)],
    ];
    const held = await Promise.all(socks.map((sock) => pids(sock)));
    runs.push(await pty(job, 'close'), await pty(temporary, 'close'));
    await Promise.all(socks.map((sock, index) => cleared(sock, held[index] ?? [])));
    expect(runs).toEqual([
      [0, `${socks[0]}\n`, ''],
      [0, `${socks[1]}\n`, ''],
      [1, '', 'ctrl+r opened no edit field on agents\n'],
      ['700'],
      OK,
      OK,
    ]);
  },
  TIMEOUT_MS,
);

// The holder exits 0 and removes its socket when its child exits and on SIGHUP, SIGINT, SIGTERM; the socket a killed
// holder leaves is replaced. A screen with no cursor row selects nothing.
macos(
  'cleans up after the child, a signal and a killed holder',
  async () => {
    const directory = await scratch();
    const ends = ['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGTERM', 'q'];
    const socks = ends.map((end) => `${directory}/${end}.sock`);
    const holders = socks.map((sock) =>
      Bun.spawn([process.execPath, SCRIPT, 'hold', `--sock=${sock}`, ...fake('0', '0', 'one')]),
    );
    const held = await Promise.all(socks.map((sock) => pids(sock)));
    await Promise.all(
      ends.map((end, index) =>
        end === 'q'
          ? pty(plain, 'send', `--sock=${socks[index]}`, end)
          : holders[index]?.kill(end as NodeJS.Signals),
      ),
    );
    const ended = await Promise.all(
      holders.map(async (holder) => {
        await holder.exited;
        return holder.signalCode ?? holder.exitCode;
      }),
    );
    const killed = `${directory}/SIGKILL.sock`;
    const isStale = fs.existsSync(killed);
    await Promise.all(
      socks.map((sock, index) => cleared(sock === killed ? '' : sock, held[index] ?? [])),
    );
    const flag = `--sock=${killed}`;
    const runs = [
      await pty(plain, 'open', flag, '--', 'sh', '-c', 'read line'),
      await pty(plain, 'select', flag, 'x'),
      await pty(plain, 'send', flag, String.raw`\r`),
    ];
    await cleared(killed, []);
    expect([ended, isStale, runs]).toEqual([
      [0, 0, 'SIGKILL', 0, 0],
      true,
      [[0, `${killed}\n`, ''], [1, '', "no row's name starts with x\n"], OK],
    ]);
  },
  TIMEOUT_MS,
);
