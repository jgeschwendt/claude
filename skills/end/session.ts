#!/usr/bin/env bun
// session.ts [--erase] — the last call of /end and /delete: close THIS session from a detached child, so the tool call
// returns before the CLI dies. A background job is removed from the sessions list, which stops it. `--erase` runs
// `sandman forget` first, and the child, once the CLI is gone, forgets again (an exit regrows the transcript, verified
// 2026-11-19 on a `claude stop`) and removes what forget leaves, unless the CLI outlives 60 s: a live session is
// never forgotten.
// Exit 0: armed, its one line is what the skill reports on; 1: no safe identity; 2: forget failed. Both close nothing.
import { unknown as anything, parse, record } from 'verax';

const POLL_MS = 300;
const SHORT_ID = 8;

const {
  CLAUDE_CODE_SESSION_ID: sid = '',
  CLAUDE_CODE_TMPDIR: tmpdir = '/tmp',
  CLAUDE_JOB_DIR: job,
  CLAUDE_PID: cli,
  CLAUDE_TOOL_LOG_DIR: toolLog,
  END_EXIT_LIMIT_MS: limit = '60000',
  HOME: home,
  XDG_STATE_HOME: state = `${home}/.local/state`,
} = process.env;
const pid = Number(cli);
const short = sid.slice(0, SHORT_ID);
const isErase = Bun.argv.includes('--erase');
const run = (...command: string[]): number | null =>
  Bun.spawnSync(command, { stderr: 'ignore', stdout: 'ignore' }).exitCode;
const say = async (line: string): Promise<number> => Bun.write(Bun.stdout, `${line}\n`);
const hasSignalled = (name: NodeJS.Signals | 0): boolean => {
  try {
    return process.kill(pid, name);
  } catch {
    return false;
  }
};
const attempt = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await read();
  } catch {
    return fallback;
  }
};
const object = record(anything());
const field = (line: string, key: string): unknown => {
  try {
    // a line that is not an object throws on the read, which is the miss
    return parse(JSON.parse(line), object)[key];
  } catch {
    return undefined;
  }
};
/**
Whether the CLI exits by `deadline`, polling
*/
const hasExited = async (deadline: number): Promise<boolean> => {
  const isGone = !hasSignalled(0);
  if (isGone || Date.now() > deadline) {
    return isGone;
  }
  await Bun.sleep(POLL_MS);
  return hasExited(deadline);
};

/**
The CLI pid is a live `claude` and not the daemon or its pty host, matched on the subcommand word alone: a watcher
armed on the daemon waited for a daemon restart (2026-09-05), and a prompt can hold the word (2026-10-26); the
CLI runs as `…/claude/versions/<version>` and the pty host as `claude --bg-pty-host` (observed 2026-11-26 · 2.1.332)
*/
const [argv0 = '', sub = ''] = Bun.spawnSync(['ps', '-o', 'args=', '-p', String(pid)])
  .stdout.toString()
  .trim()
  .split(/\s+/u, 2);
if (
  !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u.test(sid) ||
  !/(?:^|\/)claude(?:\/versions\/[^/]+)?$/u.test(argv0) ||
  ['bg-pty-host', 'daemon'].includes(sub.replace(/^-+/u, ''))
) {
  // a sandbox that denied `ps` still read as erased (2026-10-26)
  await say(
    '✻ cannot identify this session safely: nothing closed. Type /exit (background job: claude stop <id>).',
  );
  process.exit(1);
}
if (!Bun.argv.includes('--child')) {
  if (isErase && run('sandman', 'forget', sid) !== 0) {
    await say(
      `✻ sandman forget failed: nothing closed or erased. Type /exit, then run sandman forget ${sid}.`,
    );
    process.exit(2);
  }
  Bun.spawn([process.execPath, import.meta.path, '--child', ...Bun.argv.slice(2)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  }).unref();
  await say(isErase ? `▸ erased ${sid}; the exit is watched` : `▸ ending ${short}`);
  process.exit(0);
}

// a background job is removed, which stops it (verified 2026-11-23 · claude rm on a running background session stopped
// it, removed it and the transcript was archived at once); an interactive CLI gets Ctrl-C twice, then TERM (verified
// 2026-11-23 · a probe session in a held pty exited on the interrupts and its transcript was archived a second later)
if (job !== undefined && job !== '') {
  run('claude', 'rm', short);
} else {
  const INT_GAP_MS = 400;
  const TERM_GRACE_MS = 2000;
  hasSignalled('SIGINT');
  await Bun.sleep(INT_GAP_MS);
  hasSignalled('SIGINT');
  await Bun.sleep(TERM_GRACE_MS);
  if (hasSignalled(0)) {
    hasSignalled('SIGTERM');
  }
}
if (isErase && (await hasExited(Date.now() + Number(limit)))) {
  const FLUSH_MS = 1000;
  await Bun.sleep(FLUSH_MS);
  run('sandman', 'forget', sid);
  const fs = process.getBuiltinModule('node:fs/promises');

  /**
  `path` without the lines whose `key` is this session, rewritten through a temp file only when one is dropped
  */
  const scrub = async (path: string, key: string): Promise<void> => {
    const text = await attempt(async () => Bun.file(path).text(), '');
    const lines = text.split('\n');
    const kept = lines.filter((line) => !line.includes(sid) || field(line, key) !== sid);
    if (kept.length === lines.length) {
      return;
    }
    await Bun.write(`${path}.${sid}`, kept.join('\n'));
    await fs.rename(`${path}.${sid}`, path);
  };
  const claude = `${home}/.claude`;
  // the override's composition is read from the CLI's strings only (unverified 2026-11-19)
  const temporary = `${tmpdir}/claude-${process.getuid?.()}`;
  const logs = toolLog ?? `${state}/subether/tools`;
  const [keys = [], days = []] = await Promise.all(
    [temporary, logs].map(async (directory) => attempt(async () => fs.readdir(directory), [])),
  );
  const doomed = [
    ...[
      `debug/${sid}.txt`,
      `dev-mods/${sid}`,
      `file-history/${sid}`,
      `session-env/${sid}`,
      `tasks/${sid}`,
      `uploads/${sid}`,
    ].map((path) => `${claude}/${path}`),
    ...keys.map((key) => `${temporary}/${key}/${sid}`),
  ];
  await Promise.all([
    ...doomed.map(async (path) => fs.rm(path, { force: true, recursive: true })),
    scrub(`${claude}/history.jsonl`, 'sessionId'),
    ...days.map(async (day) => scrub(`${logs}/${day}`, 'session')),
  ]);
}
