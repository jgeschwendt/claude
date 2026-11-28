#!/usr/bin/env bun
//MISE description="Check the live Claude Code setup, read-only: parse, link, version, memory, hooks, install, mcp, plugins, skills"
// A deterministic health check of ~/.claude and ~/.claude.json, with no model calls and no writes; a weekly routine
// parses its output, one line per finding:
//   ok: <check>                      broken: <what> — <why>
//   unused: <kind> <name> — <why>    note: <text>
// then `doctor: <N> broken, <M> unused`, unused lines sorted. Exit 1 on any broken line. A file that fails to parse
// skips the checks that read it; its contents are never printed, nor an MCP server's env or headers.
// CLAUDE_HOME, CLAUDE_JSON, CLAUDE_BIN and CLAUDE_LATEST_URL redirect the inputs.
import {
  type Infer,
  type Schema,
  boolean,
  float,
  list,
  optional,
  record,
  string,
  parse as vet,
} from 'verax';
import { loose } from '#loose';

const DAY_MS = 86_400_000;
const HOOK_MS = 2000;
const HOOK_RUNS = 5;
const HOOK_SLOW_MS = 10_000;
const LATEST_TIMEOUT_MS = 10_000;
const MEMORY_CHARS = 24_000;
const PLUGIN_DAYS = 30;
const SKILL_DAYS = 60;
const SKILL_FRESH_DAYS = 30;
const TRANSCRIPT_DAYS = 30;

// the files are the harness's own, so each shape holds only the fields the checks read; a line that fails is skipped
const words = optional(string());
const numbers = optional(float());
const counts = loose('usage', { lastUsedAt: numbers, usageCount: numbers });
const usage = optional(record(counts));
const mcpServer = loose('server', { command: words, type: words });
const configShape = loose('~/.claude.json', {
  installMethod: words,
  mcpServers: optional(record(mcpServer)),
  pluginUsage: usage,
  skillUsage: usage,
});
const flags = record(boolean());
const settingsShape = loose('settings.json', { enabledPlugins: optional(flags) });
const hookRun = loose('attachment', {
  durationMs: float(),
  hookEvent: string(),
  hookName: string(),
  type: string(),
});
const toolUse = loose('block', { name: words });
const message = loose('message', { content: list(toolUse) });
const entryShape = loose('entry', {
  attachment: optional(hookRun),
  message: optional(message),
  type: string(),
});

const { CLAUDE_BIN, CLAUDE_HOME, CLAUDE_JSON, CLAUDE_LATEST_URL, HOME } = Bun.env;
const bin = CLAUDE_BIN ?? `${HOME}/.local/bin/claude`;
const found: string[] = [];
const home = CLAUDE_HOME ?? `${HOME}/.claude`;
const hooks = new Map<string, number[]>();
const now = Date.now();
const tools = new Set<string | undefined>();

/**
What `run` returns, or what `fallback` makes of its error
*/
const attempt = async <T>(
  run: () => Promise<T> | T,
  fallback: (error: unknown) => T,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    return fallback(error);
  }
};

/**
Records a check's findings, led by `ok:` when none is broken
*/
const check = (name: string, lines: readonly string[]): void => {
  found.push(
    ...(lines.some((line) => line.startsWith('broken:')) ? [] : [`ok: ${name}`]),
    ...lines,
  );
};

/**
The `---` block that opens a file, empty when there is none
*/
const front = (text: string): string => /^---\n[\s\S]*?\n---/u.exec(text)?.[0] ?? '';

const isPresent = async (path: string): Promise<boolean> =>
  attempt(
    async () => {
      await Bun.file(path).stat();
      return true;
    },
    () => false,
  );

const parse = async <T>(path: string, shape: Schema<T>): Promise<T | undefined> => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return attempt(
    async (): Promise<T | undefined> => {
      const value = vet(JSON.parse(await Bun.file(path).text()), shape);
      found.push(`ok: parse ${name}`);
      return value;
    },
    (): undefined => {
      // jq names the position without quoting the text, which JSON.parse does
      const jq = Bun.spawnSync(['jq', 'empty', path]).stderr.toString();
      const where = /line \d+, column \d+/u.exec(jq)?.[0];
      found.push(
        `broken: parse ${name} — ${where === undefined ? 'unreadable or empty' : `at ${where}`}`,
      );
    },
  );
};

/**
The sorted paths under `directory` matching `pattern`, none when it is missing
*/
const scan = async (pattern: string, directory: string): Promise<string[]> => {
  const glob = new Bun.Glob(pattern);
  const names = await attempt(
    async () => Array.fromAsync(glob.scan({ cwd: directory, followSymlinks: true })),
    (): string[] => [],
  );
  return names
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => `${directory}/${name}`);
};

const settings = await parse(`${home}/settings.json`, settingsShape);
const config = await parse(CLAUDE_JSON ?? `${HOME}/.claude.json`, configShape);

check(
  'link',
  Bun.spawnSync([`${import.meta.dir}/link`, '--check'])
    .stdout.toString()
    .split('\n')
    .map((line) =>
      line.replace(
        /^(?<state>drift|missing|stale): (?<item>.+)$/u,
        'broken: link $<item> — $<state>',
      ),
    )
    .filter((line) => line.startsWith('broken:')),
);

check(
  'version',
  await attempt(
    async () => {
      const [installed] = Bun.spawnSync([bin, '--version']).stdout.toString().trim().split(' ', 1);
      const response = await fetch(
        CLAUDE_LATEST_URL ?? 'https://downloads.claude.ai/claude-code-releases/latest',
        { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) },
      );
      const body = await response.text();
      const latest = body.trim();
      return Bun.semver.order(String(installed), latest) < 0
        ? [`note: claude ${installed} behind ${latest} — run claude update`]
        : [];
    },
    (error) => [`note: version unknown — ${String(error).replaceAll(/\s+/gu, ' ')}`],
  ),
);

const rules = await scan('*.md', `${home}/rules`);
const memory = await Promise.all(
  [`${home}/CLAUDE.md`, ...rules].map(async (path) =>
    attempt(
      async () => Bun.file(path).text(),
      () => '',
    ),
  ),
);
const chars = memory
  .filter((text) => !/^paths:/mu.test(front(text)))
  .reduce((sum, text) => sum + text.length, 0);
check('memory', [
  chars > MEMORY_CHARS
    ? `broken: always-loaded memory ${chars} chars — over ${MEMORY_CHARS}`
    : `note: always-loaded memory ${chars} chars`,
]);

const transcripts = await scan('*/*.jsonl', `${home}/projects`);
await Promise.all(
  transcripts
    .map((path) => Bun.file(path))
    .filter((file) => file.lastModified > now - TRANSCRIPT_DAYS * DAY_MS)
    .map(async (file) => {
      const text = await file.text();
      // a line that does not parse is a live session's half-written tail
      const entries = await Promise.all(
        text.split('\n').map(async (line) =>
          attempt(
            () => vet(JSON.parse(line), entryShape),
            (): Infer<typeof entryShape> => ({ type: '' }),
          ),
        ),
      );
      for (const entry of entries) {
        const blocks = entry.type === 'assistant' ? (entry.message?.content ?? []) : [];
        for (const block of blocks) {
          tools.add(block.name);
        }
        const run = entry.type === 'attachment' ? entry.attachment : undefined;
        if (
          !run ||
          !/^hook_(?:cancelled|error_during_execution|non_blocking_error|success)$/u.test(run.type)
        ) {
          continue;
        }
        const key = `${run.hookEvent} ${run.hookName}`;
        hooks.set(key, [...(hooks.get(key) ?? []), run.durationMs]);
      }
    }),
);

check(
  'hooks',
  [...hooks]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, runs]) => {
      const median = Number(
        runs.toSorted((left, right) => left - right)[Math.floor(runs.length / 2)],
      );
      const limit = /^(?:SessionStart|Stop) /u.test(key) ? HOOK_SLOW_MS : HOOK_MS;
      return runs.length >= HOOK_RUNS && median > limit
        ? `broken: hook ${key} — median ${median} ms`
        : '';
    })
    .filter(Boolean),
);

if (config) {
  check('install', [
    ...(config.installMethod === 'native'
      ? []
      : [`broken: install — installMethod ${String(config.installMethod)}, not native`]),
    ...((await isPresent(bin)) ? [] : [`broken: install — ${bin} missing`]),
    ...((await isPresent(`${home}/local`))
      ? [`broken: install — ${home}/local, a leftover npm install`]
      : []),
  ]);

  const servers = Object.entries({ ...config.mcpServers });
  check('mcp', [
    ...servers
      .filter(
        ([, server]) =>
          (server.type ?? 'stdio') === 'stdio' && Bun.which(server.command ?? '') === null,
      )
      .map(([name]) => `broken: mcp ${name} — command not found`),
    ...servers
      .filter(([name]) => {
        const prefix = `mcp__${name.replaceAll(/[^\w-]/gu, '_')}__`;
        return [...tools].every((tool) => tool?.startsWith(prefix) !== true);
      })
      .map(([name]) => `unused: mcp ${name} — no calls in ${TRANSCRIPT_DAYS} days`),
  ]);

  if (settings) {
    check(
      'plugins',
      Object.entries({ ...settings.enabledPlugins })
        .filter(([key, isOn]) => {
          const { lastUsedAt = 0, usageCount = 0 } = { ...config.pluginUsage }[key] ?? {};
          const isUsed = usageCount > 0 && lastUsedAt > now - PLUGIN_DAYS * DAY_MS;
          return isOn && !isUsed;
        })
        .map(([key]) => `unused: plugin ${key} — no use in ${PLUGIN_DAYS} days`),
    );
  }

  const skills = await scan('*/SKILL.md', `${home}/skills`);
  const findings = await Promise.all(
    skills.map(async (path) => {
      const file = Bun.file(path);
      const head = front(await file.text());
      const name = path.slice(`${home}/skills/`.length, -'/SKILL.md'.length);
      const isStale =
        ({ ...config.skillUsage }[name]?.lastUsedAt ?? 0) < now - SKILL_DAYS * DAY_MS &&
        file.lastModified < now - SKILL_FRESH_DAYS * DAY_MS;
      if (!/^name:/mu.test(head) || !/^description:/mu.test(head)) {
        return `broken: skill ${name} — frontmatter needs name and description`;
      }
      return isStale ? `unused: skill ${name} — no use in ${SKILL_DAYS} days` : '';
    }),
  );
  check('skills', findings.filter(Boolean));
}

const unused = found
  .filter((line) => line.startsWith('unused:'))
  .toSorted((left, right) => left.localeCompare(right));
const broken = found.filter((line) => line.startsWith('broken:')).length;
const report = [
  ...found.filter((line) => !line.startsWith('unused:')),
  ...unused,
  `doctor: ${broken} broken, ${unused.length} unused`,
  '',
];
await Bun.write(Bun.stdout, report.join('\n'));
process.exitCode = Number(broken > 0);
