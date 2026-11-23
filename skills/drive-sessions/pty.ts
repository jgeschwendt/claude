#!/usr/bin/env bun
// pty.ts <verb> …: hold a TUI (default `claude agents`) in a pty behind a Unix socket, so an agent with only a shell
// can read its screen and type into it. Exit 1 with one line on stderr when a verb cannot do or verify its work.
import { Terminal } from '@xterm/headless';

const DOWN = '\u{1B}[B';
const ESC = '\u{1B}';
const POLL_MS = 50;
const PRIVATE_DIR = 0o700;
const PRIVATE_SOCKET = 0o177;
const SETTLE_MS = 1000;
const START_MS = 5000;
const UP = '\u{1B}[A';
const fs = process.getBuiltinModule('node:fs');
const { CLAUDE_JOB_DIR: job } = Bun.env;
const { positionals, values } = process.getBuiltinModule('node:util').parseArgs({
  allowPositionals: true,
  options: {
    cols: { default: '200', type: 'string' },
    rows: { default: '50', type: 'string' },
    sock: {
      default: job
        ? `${job}/tmp/drive-sessions.sock`
        : `${process.getBuiltinModule('node:os').tmpdir()}/drive-sessions/pty.sock`,
      type: 'string',
    },
  },
});
const [verb = '', ...words] = positionals;
const { cols, rows, sock } = values;

type Check = (lines: string[]) => boolean;

const call = async (path: string, body = ''): Promise<string> => {
  const response = await fetch(`http://pty/${path}`, { body, method: 'POST', unix: sock });
  return response.text();
};
const fail = (reason: string): never => {
  process.stderr.write(`${reason}\n`);
  process.exit(1);
};
const alive = async (): Promise<string | undefined> => {
  try {
    return await call('screen');
  } catch {
    return undefined;
  }
};

/**
The first defined value `read` gives, polling for up to `ms`
*/
const poll = async <T>(read: () => Promise<T | undefined>, ms: number): Promise<T | undefined> => {
  const value = await read();
  if (value !== undefined || ms <= 0) {
    return value;
  }
  await Bun.sleep(POLL_MS);
  return poll(read, ms - POLL_MS);
};

/**
`keys` sent, then the screen once `isMet` holds of it
*/
const step = async (keys: string, isMet: Check): Promise<string[] | undefined> => {
  await call('send', keys);
  return poll(async () => {
    const screen = await call('screen');
    const lines = screen.split('\n');
    return isMet(lines) ? lines : undefined;
  }, SETTLE_MS);
};
const cancel = async (reason: string): Promise<never> => {
  await call('send', ESC);
  return fail(reason);
};

/**
The selected row: the first starting with `❯`, since the new-session input line below the list starts with one too
*/
const cursor = (lines: string[]): string => lines.find((line) => line.startsWith('❯')) ?? '';

/**
A row's session name: the text after the cursor column and the status glyph, up to the first column gap
*/
const name = (row: string): string => row.replace(/^.\s*\S+\s+/u, '').replace(/\s{2}.*/u, '');
const isEditing: Check = (lines) => lines.some((line) => line.includes('enter to save'));

/**
The screen once the cursor row is on `prefix`, pressing `key` while each press brings a row not `seen` before
*/
const seek = async (
  prefix: string,
  key: string,
  seen = new Set<string>(),
): Promise<string[] | undefined> => {
  const lines = await step('', (now) => !seen.has(cursor(now)));
  if (!lines || name(cursor(lines)).startsWith(prefix)) {
    return lines;
  }
  seen.add(cursor(lines));
  await call('send', key);
  return seek(prefix, key, seen);
};
const select = async (prefix: string): Promise<string[]> =>
  (await seek(prefix, UP)) ??
  (await seek(prefix, DOWN)) ??
  fail(`no row's name starts with ${prefix}`);

const verbs: Record<string, (...argv: string[]) => Promise<string>> = {
  close: async () => {
    await call('close');
    return '';
  },
  hold: async (...argv) => {
    const size = { cols: Number(cols), rows: Number(rows) };
    const term = new Terminal({ ...size, allowProposedApi: true, scrollback: 0 });
    const child = Bun.spawn(argv, {
      terminal: { ...size, data: (_terminal, bytes) => term.write(bytes) },
    });
    const kill = (): void => {
      fs.rmSync(sock, { force: true });
      child.kill();
    };
    fs.rmSync(sock, { force: true });
    process.umask(PRIVATE_SOCKET);
    Bun.serve({
      fetch: async (request) => {
        if (request.url.endsWith('/send')) {
          child.terminal?.write(await request.text());
        }
        if (request.url.endsWith('/close')) {
          kill();
        }
        const screen = term.buffer.active;
        const lines = Array.from({ length: term.rows }, (_value, row) =>
          screen.getLine(row)?.translateToString(true),
        );
        return new Response(lines.join('\n'));
      },
      unix: sock,
    });
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
      process.on(signal, kill);
    }
    await child.exited;
    kill();
    return process.exit(0);
  },
  open: async (...argv) => {
    if (await alive()) {
      return fail(`a holder already answers on ${sock}`);
    }
    fs.mkdirSync(process.getBuiltinModule('node:path').dirname(sock), {
      mode: PRIVATE_DIR,
      recursive: true,
    });
    Bun.spawn(
      [
        process.execPath,
        import.meta.path,
        'hold',
        `--cols=${cols}`,
        `--rows=${rows}`,
        `--sock=${sock}`,
        '--',
        ...(argv.length > 0 ? argv : ['claude', 'agents']),
      ],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore'] },
    ).unref();
    return (await poll(alive, START_MS)) === undefined
      ? fail(`no holder answered on ${sock}`)
      : `${sock}\n`;
  },
  remove: async (prefix) => {
    const before = await select(prefix);
    const target = name(cursor(before));
    const count = (lines: string[]): number => lines.filter((line) => name(line) === target).length;
    // a confirm that never shows still ends below, as the row still listed
    await step('\u{18}', (lines) => cursor(lines).includes('ctrl+x again to remove'));
    return (await step('\u{18}', (lines) => count(lines) < count(before)))
      ? `removed ${target}\n`
      : fail(`${target} is still listed: the confirm lapsed or was refused`);
  },
  rename: async (prefix, next) => {
    const was = name(cursor(await select(prefix)));
    if (!(await step('\u{12}', isEditing))) {
      fail(`ctrl+r opened no edit field on ${was}`);
    }
    await call('send', '\u{15}');
    if (!(await step(next, (lines) => name(cursor(lines)) === next))) {
      await cancel(`the field does not read ${next}`);
    }
    if (!(await step('\r', (lines) => !isEditing(lines)))) {
      await cancel(`${next} was not saved`);
    }
    return `renamed ${was} → ${next}\n`;
  },
  screen: async () => `${await call('screen')}\n`,
  select: async (prefix) => `${name(cursor(await select(prefix)))}\n`,
  send: async (text) => {
    await call(
      'send',
      text.replaceAll(
        /\\(?:x(?<hex>[\da-f]{2})|(?<char>.))/giu,
        (_match, hex: string | undefined, char: string) =>
          hex
            ? String.fromCodePoint(Number.parseInt(hex, 16))
            : ('\n\r\t'['nrt'.indexOf(char)] ?? char),
      ),
    );
    return '';
  },
};
const usage = (): never =>
  fail('usage: pty.ts open|screen|send|select|remove|rename|close [--sock <path>] …');
const run = verbs[verb] ?? usage;
const output = words.length < run.length ? usage() : run(...words);
try {
  process.stdout.write(await output);
} catch {
  fail(`no holder answers on ${sock}`);
}
