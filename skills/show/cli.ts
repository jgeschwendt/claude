// The agent's side of show: every verb talks to the daemon over its Unix socket, one request per call, and an
// error is `show: <code>: <message>` on stderr, the code the contract.
import { type Schema, unknown as anything, list, object, parse, string } from 'verax';
import { loose } from '#loose';
import { summaryShape } from './shapes.ts';

const { existsSync, readFileSync, realpathSync, writeFileSync } =
  process.getBuiltinModule('node:fs');

/**
the skill's own directory, through any ~/.claude symlink
*/
const DIR = realpathSync(import.meta.dir);
/**
how many times setup tries `launchctl bootstrap`, POLL_MS apart: 5 s for launchd to finish a bootout
*/
const BOOTSTRAP_TRIES = 20;
const LABEL = 'io.jlg.show';
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOENT', 'ENOTSOCK']);
/**
how long `wait` pauses before it asks a daemon that is down again
*/
const POLL_MS = 250;
/**
the radix of the version's text: a hash in base 36 is short and file-safe
*/
const RADIX = 36;
/**
how long `wait` keeps reconnecting to a daemon that went away: launchd respawns within its 10 s throttle
*/
const REJOIN_MS = 30_000;
/**
the leading characters of an id or a session shown to a person
*/
const SHORT_ID = 8;
const USAGE: Record<string, string> = {
  close: '<slug>',
  health: '',
  list: '',
  open: '<plan.json> [--slug s] [--quiet]',
  reply: '<slug> <question|thread> [--working] <text…>',
  resolve: '<slug> <question|thread>',
  serve: '',
  setup: '',
  status: '<slug> [line…]',
  update: '<slug> <plan.json> [--quiet]',
  wait: '<slug>',
};
const GLOB = new Bun.Glob('{show,*.{css,ts,tsx}}');

/**
a typed failure: `code` is what callers branch on, never `message`
*/
class FailError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'FailError';
  }
}

/**
the `code` a thrown value carries, `error` when it has none
*/
const codeOf = (error: unknown): string =>
  String(Reflect.get(new Object(error), 'code') ?? 'error');
const messageOf = (error: unknown): string =>
  Error.isError(error) ? error.message : String(error);
const failure = object('failure', {
  error: object('error', { code: string(), message: string() }),
});

/**
`${XDG_STATE_HOME:-~/.local/state}/show`, read per call so a test can move it
*/
const home = (): string => {
  const { HOME, XDG_STATE_HOME } = Bun.env;
  return `${XDG_STATE_HOME ?? `${HOME}/.local/state`}/show`;
};

/**
the sources' content hash, so an edited skill and a stale daemon disagree; SHOW_VERSION overrides it
*/
const { SHOW_VERSION } = Bun.env;
const VERSION =
  SHOW_VERSION ??
  Bun.hash(
    [...GLOB.scanSync(DIR)]
      .filter((name) => !name.includes('.test.'))
      .toSorted((left, right) => Number(left > right) - Number(left < right))
      .map((name) => readFileSync(`${DIR}/${name}`, 'utf8'))
      .join('\0'),
  ).toString(RADIX);

const FIX = `restart the daemon: launchctl kickstart -k gui/${process.getuid?.()}/${LABEL}, or \`show setup\` if the job is not installed`;

/**
hud's server module: SHOW_HUD, else the sibling `typescript` checkout's
*/
const hudPath = (): string => {
  const { SHOW_HUD } = Bun.env;
  return SHOW_HUD ?? `${DIR}/../../../../typescript/main/packages/hud/src/server.ts`;
};

/**
one request; a refused or missing socket was provably not sent, anything else is outcome unknown
*/
const send = async (method: string, path: string, body?: object): Promise<Response> => {
  const init = {
    body: body && JSON.stringify(body),
    headers: { 'x-show-version': VERSION },
    keepalive: false,
    method,
    unix: `${home()}/show.sock`,
  };
  try {
    return await fetch(`http://show${path}`, init);
  } catch (error) {
    throw NOT_SENT.has(codeOf(error))
      ? new FailError('down', `no daemon on ${home()}/show.sock: ${FIX}`)
      : new FailError('unknown', `outcome unknown: ${messageOf(error)}`);
  }
};

/**
a request and its JSON reply as `shape` reads it, a typed failure on any error body
*/
const call = async <Reply>(
  shape: Schema<Reply>,
  { body, method, path }: { body?: object; method: string; path: string },
): Promise<Reply> => {
  const response = await send(method, path, body);
  const json: unknown = await response.json();
  if (!response.ok) {
    const { error } = parse(json, failure);
    throw new FailError(error.code, error.message);
  }
  return parse(json, shape);
};

const plan = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new FailError('invalid', `${file}: ${messageOf(error)}`);
  }
};

/**
the launchd job: KeepAlive and RunAtLoad, the repo's pinned bun through mise, which execs in place; `hud`
fixes SHOW_HUD into the job, which launchd starts with none of the shell's environment
*/
const plist = (mise: string, hud?: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${hud !== undefined && hud !== '' ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>SHOW_HUD</key>\n    <string>${hud}</string>\n  </dict>\n` : ''}  <key>KeepAlive</key>
  <true/>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[mise, 'x', '-C', DIR, '--', 'bun', `${DIR}/show`, 'serve'].map((argument) => `    <string>${argument}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>${home()}/launchd.log</string>
  <key>StandardOutPath</key>
  <string>${home()}/launchd.log</string>
</dict>
</plist>
`;

/**
`launchctl bootstrap`, run again every POLL_MS while it fails, BOOTSTRAP_TRIES times at most: `bootout` returns
before launchd has unloaded the job, and a bootstrap in that window fails with "5: Input/output error"
(observed 2026-11-24 · the first `show setup` over a loaded job)
*/
const bootstrap = (argv: string[], tries = BOOTSTRAP_TRIES): Bun.SyncSubprocess<'pipe', 'pipe'> => {
  const done = Bun.spawnSync(argv);
  if (done.success || tries <= 1) {
    return done;
  }
  Bun.sleepSync(POLL_MS);
  return bootstrap(argv, tries - 1);
};

/**
show the plan in the owner's browser unless `--quiet` or SHOW_NO_BROWSER says not to; SHOW_OPENER names another opener, and no opener on a platform without one skips silently
*/
const browse = (url: string, flags: string[]): void => {
  const { SHOW_NO_BROWSER, SHOW_OPENER } = Bun.env;
  const opener = SHOW_OPENER ?? (process.platform === 'darwin' ? 'open' : '');
  if (opener !== '' && (SHOW_NO_BROWSER ?? '') === '' && !flags.includes('--quiet')) {
    try {
      Bun.spawn([opener, url], { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' }).unref();
    } catch {
      // a browser that will not open never fails the verb
    }
  }
};

const verbs: Record<string, (arguments_: string[]) => Promise<string> | string> = {
  close: async ([slug]) => {
    await call(anything(), { method: 'DELETE', path: `/plans/${slug}` });
    return `closed ${slug}`;
  },
  health: async () => {
    const health = await call(loose('health', { version: string() }), {
      method: 'GET',
      path: '/health',
    });
    if (health.version !== VERSION) {
      throw new FailError(
        'version',
        `daemon runs ${health.version}, this CLI is ${VERSION}: ${FIX}`,
      );
    }
    return JSON.stringify(health);
  },
  list: async () => {
    const open = await call(list(summaryShape), { method: 'GET', path: '/plans' });
    return (
      open
        .map(
          (one) =>
            `${one.url}  ${one.title} · ${one.yours} his turn · ${one.waiting} waiting on the agent · ${one.working} agent working · ${one.session.slice(0, SHORT_ID)}`,
        )
        .join('\n') || 'no open plans'
    );
  },
  open: async ([file = '', ...rest]) => {
    const { CLAUDE_CODE_SESSION_ID } = Bun.env;
    const { url } = await call(loose('opened', { url: string() }), {
      body: {
        plan: plan(file),
        session: CLAUDE_CODE_SESSION_ID ?? '',
        slug: rest[rest.indexOf('--slug') + 1],
      },
      method: 'POST',
      path: '/plans',
    });
    browse(url, rest);
    return url;
  },
  reply: async ([slug, target, ...text]) => {
    const { id } = await call(loose('replied', { id: string() }), {
      body: {
        target,
        text: text.filter((word) => word !== '--working').join(' '),
        working: text.includes('--working'),
      },
      method: 'POST',
      path: `/plans/${slug}/reply`,
    });
    return `replied ${id.slice(0, SHORT_ID)}`;
  },
  resolve: async ([slug, target]) => {
    const { resolved } = await call(loose('resolved', { resolved: string() }), {
      body: { target },
      method: 'POST',
      path: `/plans/${slug}/resolve`,
    });
    return `resolved ${resolved}`;
  },
  serve: async () => {
    const server = await import('./server.tsx');
    await server.serve();
    return '';
  },
  setup: () => {
    const { HOME, PATH, SHOW_HUD } = Bun.env;
    // refused before anything changes: a job without hud would replace a working one and come up degraded
    if (!existsSync(hudPath())) {
      throw new FailError(
        'hud_off',
        `no hud server at ${hudPath()}: SHOW_HUD=<hud's src/server.ts> show setup`,
      );
    }
    const file = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
    const domain = `gui/${process.getuid?.()}`;
    // resolved through the live PATH: Bun.spawn and a bare Bun.which keep the one the process started with
    const launchctl = String(Bun.which('launchctl', { PATH: PATH ?? '' }));
    const mise = String(Bun.which('mise', { PATH: PATH ?? '' }));
    writeFileSync(file, plist(mise, SHOW_HUD));
    Bun.spawnSync([launchctl, 'bootout', `${domain}/${LABEL}`]);
    const { exitCode, stderr } = bootstrap([launchctl, 'bootstrap', domain, file]);
    if (exitCode) {
      throw new FailError(
        'setup',
        `launchctl bootstrap ${domain} ${file}: ${stderr.toString().trim()}`,
      );
    }
    return `loaded ${LABEL} from ${file}`;
  },
  status: async ([slug, ...lines]) => {
    await call(anything(), { body: { lines }, method: 'PUT', path: `/plans/${slug}/status` });
    return `status ${slug}: ${lines.length} lines`;
  },
  update: async ([slug, file = '', ...rest]) => {
    const { url } = await call(loose('updated', { url: string() }), {
      body: { plan: plan(file) },
      method: 'PUT',
      path: `/plans/${slug}`,
    });
    browse(url, rest);
    return url;
  },
  wait: async ([slug]) => {
    const cursor = `${home()}/${slug}/cursor`;
    const after = Number(Bun.file(cursor).size > 0 ? readFileSync(cursor, 'utf8') : 0);
    const since = Date.now();
    // a daemon that is down or stopping is retried until it respawns; any other error ends the wait
    const poll = async (): Promise<string> => {
      try {
        const event = await call(anything(), {
          method: 'GET',
          path: `/plans/${slug}/events?after=${after}`,
        });
        writeFileSync(cursor, String(after + 1));
        return JSON.stringify(event);
      } catch (error) {
        if (
          !['down', 'stopping', 'unknown'].includes(codeOf(error)) ||
          Date.now() - since > REJOIN_MS
        ) {
          throw error;
        }
        await Bun.sleep(POLL_MS);
        return poll();
      }
    };
    return poll();
  },
};

/**
one CLI invocation: its exit code and the text for stdout (0) or stderr
*/
const run = async ([verb = '', ...verbArguments]: string[]): Promise<[number, string]> => {
  const verbFunction = verbs[verb];
  if (!verbFunction || verbArguments.length < (USAGE[verb]?.match(/</gu) ?? []).length) {
    return [
      1,
      `show: usage: ${Object.entries(USAGE)
        .map(([name, rest]) => `show ${name} ${rest}`.trim())
        .join('\n  ')}`,
    ];
  }
  try {
    return [0, await verbFunction(verbArguments)];
  } catch (error) {
    return [1, `show: ${codeOf(error)}: ${messageOf(error)}`];
  }
};

export { DIR, FailError, FIX, home, hudPath, messageOf, plist, run, VERSION };
