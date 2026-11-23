// End-to-end checks on the doctor task, copied with link into a scratch Git checkout whose items link into a scratch
// home, run against a scratch config, a stand-in claude and a local server answering the latest version.
import { afterAll, expect, test } from 'bun:test';

const BIG_CHARS = 30_000;
const DAY_MS = 86_400_000;
const FAST_MS = 10;
const LAPSED_DAYS = 61;
const OVER_CHARS = 24_001;
const OVER_MS = 3000;
const SLOW_MS = 9000;
const START_MS = 5000;
const STOP_MS = 11_000;
const STALE_DAYS = 31;
const USES = 3;

const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE_')),
);
const now = Date.now();
const server = Bun.serve({
  fetch: (request) => {
    const { pathname } = new URL(request.url);
    return new Response(pathname.slice(1));
  },
  port: 0,
});
afterAll(() => server.stop());

/**
A scratch HOME holding `.claude.json` as `config` and a claude reporting 2.1.0, beside a checkout holding `files`;
`doctor` runs the task with `environment` over the inherited one, the latest version answered as `latest`
*/
const rig = async (
  files: Record<string, string>,
  config: string,
): Promise<{
  checkout: string;
  doctor: (latest: string, environment?: Record<string, string>) => Promise<string>;
  home: string;
  link: () => Promise<unknown>;
  root: string;
}> => {
  const made = await Bun.$`realpath $(mktemp -d)`.text();
  const root = made.trim();
  const [checkout, home] = [`${root}/checkout`, `${root}/.claude`];
  await Bun.$`mkdir -p ${home} ${checkout}/.mise/tasks && cp ${import.meta.dir}/link ${import.meta.dir}/doctor.ts ${checkout}/.mise/tasks/`;
  await Promise.all(
    Object.entries({
      ...files,
      '../.claude.json': config,
      '../.local/bin/claude': '#!/bin/sh\necho "2.1.0 (Claude Code)"\n',
    }).map(([path, text]) => Bun.write(`${checkout}/${path}`, text)),
  );
  await Bun.$`chmod +x ${root}/.local/bin/claude && git -C ${checkout} init -q`;
  const doctor = async (latest: string, environment = {}): Promise<string> => {
    const run = await Bun.$`${checkout}/.mise/tasks/doctor.ts`
      .env({
        ...inherited,
        CLAUDE_LATEST_URL: `${server.url.href}${latest}`,
        HOME: root,
        ...environment,
      })
      .nothrow()
      .quiet();
    return `${run.exitCode}\n${run.stdout.toString()}`;
  };
  const link = (): Promise<unknown> =>
    Bun.$`${checkout}/.mise/tasks/link`.env({ ...inherited, HOME: root }).quiet();
  return { checkout, doctor, home, link, root };
};

/**
The doctor output: the exit code, then one line per finding
*/
const out = (code: number, ...lines: string[]): string => [code, ...lines, ''].join('\n');

/**
A transcript line holding one assistant turn's tool calls
*/
const calls = (...names: string[]): string =>
  JSON.stringify({
    message: {
      content: [{ text: 'hi', type: 'text' }, ...names.map((name) => ({ name, type: 'tool_use' }))],
    },
    type: 'assistant',
  });

/**
Transcript lines for runs of one hook, one per duration
*/
const runs = (
  hook: { hookEvent: string; hookName: string; type: string },
  ...durations: number[]
): string[] =>
  durations.map((durationMs) =>
    JSON.stringify({ attachment: { ...hook, durationMs }, type: 'attachment' }),
  );

/**
A hook run's identity in a transcript attachment
*/
const hook = (type: string, hookEvent: string, hookName: string): Parameters<typeof runs>[0] => ({
  hookEvent,
  hookName,
  type,
});

const skill = (head: string): string => `${head}\nbody\n`;

/**
A SKILL.md whose frontmatter is whole
*/
const named = (name: string): string => skill(`---\nname: ${name}\ndescription: d\n---`);

// A linked home with every check passing, the inputs found from HOME: unused items and a version behind are reported
// without failing; a path-scoped rule is not counted, an old transcript's calls, malformed lines and a skill directory
// without SKILL.md are ignored, and a second run prints the same lines.
test('passes a healthy setup, reporting what is unused', async () => {
  const { checkout, doctor, home, link } = await rig(
    {
      'rules/a.md': 'rule\n',
      'rules/scoped.md': `---\npaths:\n  - '**/*.x'\n---\n${'x'.repeat(BIG_CHARS)}`,
      'skills/fresh/SKILL.md': named('fresh'),
      'skills/lapsed/SKILL.md': named('lapsed'),
      'skills/never/SKILL.md': named('never'),
      'skills/notes/notes.txt': '',
      'skills/used/SKILL.md': named('used'),
      'user/CLAUDE.md': 'memory\n',
      'user/settings.json': JSON.stringify({
        enabledPlugins: {
          'absent@m': true,
          'fresh@m': true,
          'nodate@m': true,
          'off@m': false,
          'old@m': true,
          'zero@m': true,
        },
      }),
    },
    JSON.stringify({
      installMethod: 'native',
      mcpServers: {
        'abs': { command: '/bin/sh' },
        'idle': { command: '/bin/sh' },
        'my.server': { command: 'sh', env: { TOKEN: 'secret' }, type: 'stdio' },
        'web': { headers: { Authorization: 'secret' }, type: 'http', url: 'https://example.com' },
      },
      pluginUsage: {
        'fresh@m': { lastUsedAt: now - DAY_MS, usageCount: USES },
        'nodate@m': { usageCount: USES },
        'old@m': { lastUsedAt: now - STALE_DAYS * DAY_MS, usageCount: USES },
        'zero@m': { lastUsedAt: now, usageCount: 0 },
      },
      skillUsage: {
        lapsed: { lastUsedAt: now - LAPSED_DAYS * DAY_MS },
        used: { lastUsedAt: now - DAY_MS },
      },
    }),
  );
  await Bun.$`mkdir -p ${home}/projects/p && /usr/bin/touch -t 202001010000 ${checkout}/skills/{lapsed,never,used}/SKILL.md`;
  await Bun.write(
    `${home}/projects/p/new.jsonl`,
    [
      calls('mcp__abs__run', 'mcp__my_server__go', 'Read'),
      calls('mcp__web__get'),
      JSON.stringify({ message: { content: 'typed' }, type: 'user' }),
      '{"type":"assistant"}',
      '{"type":"attachment"}',
      ...runs(
        hook('hook_success', 'PreToolUse', 'PreToolUse:Bash'),
        FAST_MS,
        FAST_MS,
        FAST_MS,
        FAST_MS,
        FAST_MS,
      ),
      ...runs(hook('hook_additional_context', 'PreToolUse', 'PreToolUse:Bash'), SLOW_MS),
      '{"type":"assis',
    ].join('\n'),
  );
  await Bun.write(`${home}/projects/p/old.jsonl`, calls('mcp__idle__x'));
  await Bun.$`/usr/bin/touch -t 202001010000 ${home}/projects/p/old.jsonl`;
  await link();
  const expected = out(
    0,
    'ok: parse settings.json',
    'ok: parse .claude.json',
    'ok: link',
    'ok: version',
    'note: claude 2.1.0 behind 2.2.0 — run claude update',
    'ok: memory',
    'note: always-loaded memory 12 chars',
    'ok: hooks',
    'ok: install',
    'ok: mcp',
    'ok: plugins',
    'ok: skills',
    'unused: mcp idle — no calls in 30 days',
    'unused: plugin absent@m — no use in 30 days',
    'unused: plugin nodate@m — no use in 30 days',
    'unused: plugin old@m — no use in 30 days',
    'unused: plugin zero@m — no use in 30 days',
    'unused: skill lapsed — no use in 60 days',
    'unused: skill never — no use in 60 days',
    'doctor: 0 broken, 7 unused',
  );
  expect(await doctor('2.2.0')).toBe(expected);
  expect(await doctor('2.2.0')).toBe(expected);
});

// Every broken branch at once, the inputs named by CLAUDE_HOME, CLAUDE_JSON and CLAUDE_BIN: settings that fail to
// parse are named by position alone and skip the plugin check; a missing claude makes the version unknown, a note.
test('reports what is broken', async () => {
  const { checkout, doctor, home, link, root } = await rig(
    {
      'rules/a.md': 'rule\n',
      'skills/nodesc/SKILL.md': skill('---\nname: nodesc\n---'),
      'skills/nofront/SKILL.md': skill('name: nofront\ndescription: d'),
      'skills/noname/SKILL.md': skill('---\ndescription: d\n---'),
      'skills/s/SKILL.md': skill('---\nname: s\ndescription: d\n---'),
      'user/CLAUDE.md': 'x'.repeat(OVER_CHARS),
      'user/settings.json': '{"a": secret}',
    },
    JSON.stringify({
      installMethod: 'npm-global',
      mcpServers: {
        absent: { command: '/nonexistent/doctor' },
        bare: { command: 'no-such-doctor', type: 'stdio' },
        nocmd: { type: 'stdio' },
      },
    }),
  );
  await link();
  await Bun.$`mkdir -p ${home}/local ${home}/projects/p && rm ${home}/rules/a.md ${home}/skills/s && mkdir ${home}/skills/s && ln -s ${checkout}/rules/gone.md ${home}/rules/gone.md`;
  await Bun.write(
    `${home}/projects/p/t.jsonl`,
    [
      ...runs(hook('hook_success', 'PostToolUse', 'PostToolUse:Write'), OVER_MS, OVER_MS, 1),
      ...runs(hook('hook_non_blocking_error', 'PostToolUse', 'PostToolUse:Write'), OVER_MS, 1),
      ...runs(
        hook('hook_success', 'SessionStart', 'SessionStart:startup'),
        START_MS,
        START_MS,
        START_MS,
        START_MS,
        START_MS,
      ),
      ...runs(hook('hook_error_during_execution', 'Stop', 'Stop'), STOP_MS, STOP_MS, STOP_MS),
      ...runs(hook('hook_cancelled', 'Stop', 'Stop'), STOP_MS, STOP_MS),
      ...runs(
        hook('hook_success', 'PreToolUse', 'PreToolUse:slow'),
        SLOW_MS,
        SLOW_MS,
        SLOW_MS,
        SLOW_MS,
      ),
    ].join('\n'),
  );
  const result = await doctor('2.2.0', {
    CLAUDE_BIN: `${root}/nobin`,
    CLAUDE_HOME: home,
    CLAUDE_JSON: `${root}/.claude.json`,
  });
  expect(result).toBe(
    out(
      1,
      'broken: parse settings.json — at line 1, column 13',
      'ok: parse .claude.json',
      'broken: link rules/a.md — missing',
      'broken: link skills/s — drift',
      'broken: link rules/gone.md — stale',
      'ok: version',
      `note: version unknown — Error: ENOENT: no such file or directory, posix_spawn '${root}/nobin'`,
      'broken: always-loaded memory 24001 chars — over 24000',
      'broken: hook PostToolUse PostToolUse:Write — median 3000 ms',
      'broken: hook Stop Stop — median 11000 ms',
      'broken: install — installMethod npm-global, not native',
      `broken: install — ${root}/nobin missing`,
      `broken: install — ${home}/local, a leftover npm install`,
      'broken: mcp absent — command not found',
      'broken: mcp bare — command not found',
      'broken: mcp nocmd — command not found',
      'broken: skill nodesc — frontmatter needs name and description',
      'broken: skill nofront — frontmatter needs name and description',
      'broken: skill noname — frontmatter needs name and description',
      'unused: mcp absent — no calls in 30 days',
      'unused: mcp bare — no calls in 30 days',
      'unused: mcp nocmd — no calls in 30 days',
      'doctor: 16 broken, 3 unused',
    ),
  );
  expect(result).not.toContain('secret');
});

// An unlinked, empty home and a config that does not parse: every check reading the config is skipped, the version
// matches its +build, and nothing of the config is printed.
test('skips what an unparseable config feeds', async () => {
  const { doctor } = await rig({ 'user/settings.json': '{}' }, '{"token": "sk-secret",}');
  const result = await doctor('2.1.0+build.7');
  expect(result).toBe(
    out(
      1,
      'broken: parse settings.json — unreadable or empty',
      'broken: parse .claude.json — at line 1, column 23',
      'broken: link settings.json — missing',
      'ok: version',
      'ok: memory',
      'note: always-loaded memory 0 chars',
      'ok: hooks',
      'doctor: 3 broken, 0 unused',
    ),
  );
  expect(result).not.toContain('sk-secret');
});
