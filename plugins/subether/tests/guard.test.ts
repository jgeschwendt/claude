import type { On } from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

const BIN = '/home/test/.local/bin/sandman';
const PREFIX = 'subether: ';
const RATIONALE = 200;
const TRAIL_TIMEOUT = 5000;

/**
the deny table's repeat counts: past the 16 nesting levels and 64 groups, or long lines within them
*/
const CONFIGS = 999;
const EVALS = 20_000;
const EXECS = 4000;
const EXPANSIONS = 20;
const FILLER = 9999;
const FINDS = 30_000;
const FLAGS = 5000;
const GIT_DIRS = 45;
const MISE_RUNS = 24;
const OPTIONS = 99;
const PREFIXES = 2000;
const SUBSTITUTIONS = 100;
const WRAPS = 40;

/**
A typed fixture from JSON, which keeps the environment's and the tools' names in their own notation
*/
const fixture: <T>(json: string) => T = JSON.parse;

/**
perpetual 0.2.12's deny table (origin/main `plugins/perpetual/tests/perpetual.test.ts`), row for row: each subject by
the text of the rule that denies it
*/
const DENIED: Record<string, string[]> = {
  'git checkout --': [
    'cd x && git checkout -- src/a.rs',
    'git checkout HEAD --',
    'git -C /r checkout HEAD -- .',
    'git -C /r "checkout" -- .',
    'git --work-tree /x checkout -- f',
    'xargs -0 git checkout -- f',
    'xargs -I{} git checkout -- {}',
    String.raw`find . -name '*.rs' -exec git checkout -- {} \;`,
    'find . -okdir git restore {} +',
    'git checkout .',
    'git checkout -f',
    'git checkout -fb x',
    'git checkout --force main',
    'git switch -f x',
    'git switch --discard-changes x',
    'git switch --force x',
    'git restore f',
    'git restore .',
    'git restore --staged --worktree f',
    'git restore -SW f',
    'git restore --source=X f',
    'git checkout --pathspec-from-file=f',
    'git checkout HEAD --pathspec-fr f',
    'git restore --pathspec-from-file=f',
    'git read-tree -u --reset HEAD',
    'git read-tree --reset HEAD',
    'git read-tree -mu HEAD',
    'git read-tree -qmu HEAD',
    `git checkout '--pathspec-from-file=f'`,
    'git -c include.path=f n',
    'git -c includeIf.onbranch:main.path=f n',
    "git -c alias.n='reset --hard' n",
    "git -c alias.n='!git reset --hard' n",
    "git -c 'ALIAS.n=checkout -- .' n",
    'git --config-env=alias.n=V n',
    'git -C /r --config-env alias.n=V n',
    `git ${'-c a=b '.repeat(CONFIGS)}-c alias.n=x n`,
    'git checkout HEAD src/a.rs',
    'git checkout main~1 src/',
    'git checkout --ours f',
    'git checkout ./',
    'git checkout :/',
    'git checkout src/',
    'git checkout-index -f -a',
    'GIT_CONFIG_PARAMETERS="\'alias.nk=stash\'" git nk',
    'git restore -s HEAD -SW f',
    'git restore --staged f --worktree',
    'git restore --source HEAD --staged --worktree f',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.nk GIT_CONFIG_VALUE_0=stash git nk',
  ],
  'git clean': [
    'git clean',
    'git clean -f',
    'git clean -xdf',
    'git clean -fen',
    'git clean -fd',
    'git "clean" -fd',
    '{ sudo git clean -fdx; }',
    'for r in a b; do git clean -fd; done',
    'ls\ngit clean -fd',
    'if true; then :; elif git clean -fd; fi',
    'git clean -fd -e --dummy',
    'git clean -fdx x--d',
    'git clean -f "a --d"',
  ],
  'git reset --hard': [
    'git reset --hard origin/main',
    'if true; then git reset --hard; fi',
    'git reset \\\n  --hard HEAD~1',
    '/usr/bin/git reset --hard',
    'git reset --har',
    'git reset --ha',
    "git 'reset' --hard",
    "bash -c 'git reset --hard'",
    '(cd /r; git reset --hard)',
    'git reset --hard # back',
    'noglob git reset --hard HEAD^',
    '((x = 1 << 2))\ngit reset --hard',
  ],
  'never `git stash`': [
    'git stash',
    'git stash pop',
    'x=$(git stash)',
    'FOO="a b" git stash',
    'X=$(date +%s) Y=`id` git stash',
    `git -C $(pwd) -C \${HOME}/r stash`,
    'if git stash; then :; fi',
    'while git stash; do :; done',
    '! git stash',
    'mise x -C /some/repo -- git stash',
    'mise x node@22 -- git stash',
    'mise x -q python@3.12 npm:oxfmt@0.67 git stash',
    'doas git stash',
    'builtin command git stash',
    'sudo -u me git stash',
    'env -i git stash',
    'nice git stash',
    'time -p git stash',
    'exec -a x git stash',
    'eval git stash',
    'sh -c "git stash"',
    String.raw`\git stash`,
    '"git" stash',
    'git "stash"',
    'git -C "/r/my dir" stash',
    'git --git-dir /r/.git stash',
    'git -P stash',
    'git -Z stash',
    'git --no-pager stash',
    "git -c a=b -C '/r/x y' --namespace n --super-prefix s --config-env k=v stash",
    `git ${'-P '.repeat(OPTIONS)}stash`,
    `find . ${'-exec sudo -u a '.repeat(EXECS)}git stash`,
    "git $'stash'",
    String.raw`git $'st\x61sh'`,
    "git st''ash",
    '"g"it stash',
    String.raw`g\it stash`,
    'echo `git stash`',
    'echo "`git stash`"',
    'x=y; echo "$(git stash)"',
    'cat <(git stash)',
    'cat <<EOF\n$(git stash)\nEOF',
    '>/dev/null git stash',
    '2>&1 git stash',
    'git stash &>/dev/null',
    'case x in x) git stash;; esac',
    'f() { git stash; }; f',
    'function f { git stash; }; f',
    'git\tstash',
    'watch -n1 git stash',
    'caffeinate -i git stash',
    'script -q /dev/null git stash',
    'stdbuf -o0 git stash',
    'coproc git stash',
    "fish -c 'git stash'",
    "zsh -lc 'git stash'",
    'command -p git stash',
    'timeout -s KILL 5 git stash',
    'nice -n 5 git stash',
    'sudo -E -u me git stash',
    'env -u FOO git stash',
    'env -C /r FOO=1 git stash',
    'xargs -n1 -I{} git stash',
    'mise exec -- git stash',
    'mise x --cd /r -- git stash',
    'git -C"/r" stash',
    'nocorrect git stash',
    'mise x -E dev -- git stash',
    'mise x --env dev -- git stash',
    'mise -C /r x -- git stash',
    'mise --cd /r exec -- git stash',
    `echo \${x:-$(git stash)}`,
    'echo "$( (true); git stash )"',
    'echo $((git stash) )',
    'env -P /usr/bin git stash',
    'xargs -J % git stash',
    'sudo --prompt x git stash',
    'watch -d -n 1 git stash',
    'parallel -j 4 git stash ::: a',
    'GIT stash',
    'Git stash',
    'echo "$(case $x in a) echo 1;; *) echo 2;; esac)" && git stash',
    'y="$(case "$1" in -h) echo h;; esac)"\ngit stash',
    'echo "$(for f in *; do case $f in *.md) echo;; esac; done; git stash)"',
    'echo "$({ case a in a) true;; esac; }; git stash)"',
    'arr=($(git stash))',
    'local a=(`git stash`)',
    '((git stash) )',
    'mise x --jobs 2 -- git stash',
    'echo $(( $(git stash) + 1 ))',
    '(( $(git stash | wc -l) > 0 ))',
    `echo "\${x:-{}"; git stash`,
    `echo "\${x:-\\{}"; git stash`,
    'echo "$(case a in a) true;; esac; git stash)"',
    'gtimeout 5 git stash',
    'xcrun git stash',
    'git --attr-source HEAD stash',
    `${'eval '.repeat(EVALS)}git stash`,
    'echo $(git stash',
    String.raw`git $'\163tash'`,
    String.raw`find . -exec echo {} \; -exec git stash \;`,
  ],
  'never force-push': [
    'git push --force origin x',
    'git push -f',
    'git push --force-with-lease=main',
    'git push -fu origin main',
    'git push origin +main',
    'git push origin "+main"',
    "git push origin '+main:main'",
    'GIT_DIR=/r/.git git push -f',
    'GIT_SSH_COMMAND="ssh -i k" git push -f origin x',
    'A= git push -f',
    'env git push -f',
    'if x; then :; else xargs time nohup exec command git push -f x; fi',
    'git push origin main \\\n  --force',
    'mise x -- git push -f',
    'if true; then git push -f; fi',
    'timeout 5 git push --force',
    'git push --force-w',
    'git push --forc',
    "zsh -c 'git push -f'",
    'git push -o x -f',
    'git push origin main --force-if-includes --force',
  ],
  'pkill -f matches every process': [
    'pkill -if node',
    'pkill --full node',
    '/usr/bin/pkill -f node',
    'pkill -9 -f node',
    'pkill -SIGKILL -f node',
    'pkill node -f',
    'PKILL -f node',
  ],
  'the guard cannot read': [
    `find . ${'-exec find . '.repeat(FINDS)}x`,
    `echo ${'${x:-'.repeat(EXPANSIONS)}`,
    `${'$('.repeat(SUBSTITUTIONS)}x`,
  ],
};

/**
the same table's allowed command lines
*/
const ALLOWED: string[] = [
  'git stash list; git stash show -p; git stash -h; git stash --help; git cleanup',
  `git "stash" list; git 'stash' show`,
  'git clean -n; git clean --dry-run -d; git clean -nd',
  'git checkout main; git checkout -b fix; git switch -c fix; git switch main',
  'git switch --force-create x; git restore --staged f; git restore -S .',
  'mise x -C /r -- cargo test',
  'mise x node@22 -- echo git stash',
  'mise x -- echo git stash; sudo -- echo git clean',
  String.raw`find . -exec echo git stash {} \;`,
  `${'mise x -q a@b '.repeat(WRAPS)}echo hi\n${'sudo -u x@y '.repeat(WRAPS)}echo hi`,
  `find . ${'-exec sudo -u a '.repeat(EXECS)}`,
  'git restore -h; git restore-mtime',
  'git -c color.ui=never status; git -c core.x=y -c aliases.n=x status; git -c x.alias.n=y log; git -c x.include.path=f log',
  'git read-tree HEAD; git read-tree -m HEAD; git read-tree --prefix=u/ HEAD; git read-tree-x -u',
  'git restore --staged --pathspec-from-file=f; git checkout --pathspec-file-nul main',
  `${'mise x -C r -- '.repeat(MISE_RUNS)}echo hi\n${'mise x -C r --\n'.repeat(MISE_RUNS)}echo hi`,
  'git push origin mod',
  'pkill node',
  'git reset HEAD~1',
  'git commit -m "never git stash"',
  'git checkout main\nls -- src',
  'git push origin main\nls -f',
  'git push origin main & ls -f',
  'echo git push -f',
  'git reset HEAD~1\ngrep --hard x',
  'pkill -x node\nls -f',
  'git push --follow-tags --force-if-includes origin main',
  'git --no-pager show stash@{0}',
  'git --no-pager diff stash@{0} -- f',
  'git --no-pager grep clean',
  'git --no-pager log --grep stash',
  `git ${'--a '.repeat(FLAGS)}`,
  `git ${'--git-dir '.repeat(GIT_DIRS)}`,
  'git --exec-path /x stash',
  'git reset --h',
  'sudo echo git stash',
  `${'A=x sudo -u env -c k=v '.repeat(PREFIXES)}${' '.repeat(FILLER)}`,
  `git ${'--git-dir=a '.repeat(OPTIONS)}checkout x`,
  `cat > a.js <<'EOF'\n${";a=b(c)&&d||e;x='".repeat(FILLER)}\nEOF`,
  "git commit -m 'guard: block `git stash` push'",
  "git commit -F - <<'EOF'\nperpetual: deny `git clean`\nEOF",
  "rg -F '`git stash`' README.md",
  'gh pr create --body "- \\`git reset --hard\\` abbreviations"',
  'rg "foo|git stash" src',
  "rg -n 'git reset --hard|git stash' .",
  'git commit -m "fix guard; git stash now denied"',
  'gh pr create --body "$(cat <<\'EOF\'\n## Summary\n- git stash is denied\nEOF\n)"',
  "cat > notes.md <<'EOF'\ngit reset --hard\nEOF",
  'cat <<-EOF\n\tgit stash\n\tEOF\ngit status',
  'echo "(git stash)"',
  "echo 'use { git clean -n } first'",
  'sandman remember "never git stash; use WIP commits"',
  `echo $(date) git stash; echo $((1+2)) git stash; echo \${HOME} git stash`,
  'git checkout -b x origin/x; git checkout --no-track -b y origin/y; git checkout -',
  'git clean -h; git push --dry-run origin x; git read-tree --empty',
  'ls # git stash',
  'constructor git stash',
  `arr=(git reset --hard); echo \${arr[@]}`,
  '((n = 1 << 2)); echo $n',
  'mise run x -- git stash',
  'kind="$(case "$f" in *.md) echo doc;; *) echo code;; esac)"; git commit -m "say (never) git stash"',
  `echo "\${msg:-(git stash)}"; echo "\${x:-a; git stash}"; cmds=(git reset --hard)`,
  'git checkout :/fix; git checkout-index -a -f --prefix=/tmp/export/',
  'command -v git stash; echo $(case a in a) echo git stash;; esac)',
  String.raw`rg "\d+ git stash"`,
  'cat <<EOF\nsay "git stash"\nEOF',
  String.raw`git $'st\ash'`,
  'bash x.sh git stash',
];

/**
The engine beneath: `sandman` answering `exitCode` (or refusing to start), `$.session.id` refused its first `failures`
times, the tool log's append answering ok, every run's argv and init, the log, and every call that reached the bottom
*/
const engine = (
  on: On,
  {
    environment = {} as Record<string, string>,
    exitCode = 0,
    failures = 0,
    isRefused = false,
  } = {},
): {
  calls: unknown[];
  logs: string[];
  runs: { argv: readonly string[]; init: unknown }[];
} => {
  const calls: unknown[] = [];
  const logs: string[] = [];
  const runs: { argv: readonly string[]; init: unknown }[] = [];
  mock.clock(on, { now: 0 });
  mock.env(on, {
    ...fixture<Record<string, string>>('{"CLAUDE_TOOL_LOG_DIR":"/logs","HOME":"/home/test"}'),
    ...environment,
  });
  on('process.run', ($, e) => {
    const ran = { isStderrTruncated: false, isStdoutTruncated: false, stdout: '' };
    if (e.argv[0] !== BIN) {
      return { value: { ...ran, exitCode: 0, stderr: '' } };
    }
    runs.push({ argv: e.argv, init: e.init });
    if (isRefused) {
      return { deny: 'spawn ENOENT' };
    }
    return { value: { ...ran, exitCode, stderr: '\nboom\nmore' } };
  });
  on('session.cwd', () => ({ value: '/w' }));
  let failed = 0;
  on('session.id', () => {
    failed += 1;
    if (failed <= failures) {
      return { deny: 'no session\nmore' };
    }
    return { value: 's1' };
  });
  on('tool.call', ($, e) => {
    calls.push(e);
    return { result: 'ran' };
  });
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return { calls, logs, runs };
};

/**
An Edit of `path`, from JSON for the tool's snake_case field names
*/
const edit = (path: string): Parameters<Engine['tool']['call']>[0] =>
  fixture(`{"file_path":"${path}","new_string":"b","old_string":"a","tool":"Edit"}`);

const bash = async ($: Engine, command: string): Promise<unknown> =>
  await $.tool.call({ command, tool: 'Bash' });

const byText = (left = '', right = ''): number => left.localeCompare(right);

/**
The reason a denial carries, after `subether: ` and before the closing period
*/
const reasonOf = (result: unknown): string =>
  String((result as { deny?: string }).deny).slice(PREFIX.length, -1);

for (const [rule, subjects] of Object.entries(DENIED)) {
  test(`a Bash call is denied by "${rule}", each denial trailed`, async ($, on) => {
    const { calls, runs } = engine(on);
    const results = await Promise.all(subjects.map(async (subject) => await bash($, subject)));
    expect(results).toEqual(subjects.map(() => ({ deny: expect.stringContaining(rule) })));
    const rationales = subjects.map(
      (subject, at) => `${reasonOf(results[at])}: ${subject.slice(0, RATIONALE)}`,
    );
    expect(runs.map(({ argv }) => argv[argv.indexOf('--kind') + 1])).toEqual(
      subjects.map(() => 'guard'),
    );
    expect(runs.map(({ argv }) => argv[argv.indexOf('--rationale') + 1]).toSorted(byText)).toEqual(
      rationales.toSorted(byText),
    );
    expect(runs).toHaveLength(subjects.length);
    expect(calls).toEqual([]);
  });
}

test('every allowed command line reaches the engine, and trails nothing', async ($, on) => {
  const { calls, runs } = engine(on);
  const results = await Promise.all(ALLOWED.map(async (command) => await bash($, command)));
  expect(results).toEqual(ALLOWED.map(() => ({ result: 'ran' })));
  expect(calls).toHaveLength(ALLOWED.length);
  expect(runs).toEqual([]);
});

test('a denied Bash call answers the house rule and trails it', async ($, on) => {
  const { calls, logs, runs } = engine(on);
  const subject = `git ${'-c a=b '.repeat(CONFIGS)}-c alias.n=x n`;
  const result = await bash($, subject);
  const reason = reasonOf(result);
  expect(result).toEqual({ deny: `${PREFIX}${reason}.` });
  expect(reason).toMatch(/^never mutate to inspect — `git checkout --`/u);
  expect(runs).toEqual([
    {
      argv: [
        BIN,
        'trail',
        'append',
        '--kind',
        'guard',
        '--rationale',
        `${reason}: ${subject.slice(0, RATIONALE)}`,
        '--ref',
        'session:s1',
      ],
      init: { timeoutMs: TRAIL_TIMEOUT },
    },
  ]);
  expect(calls).toEqual([]);
  expect(logs).toEqual([]);
});

test('a denial carries SANDMAN_SHIFT when set', async ($, on) => {
  const { runs } = engine(on, {
    environment: fixture<Record<string, string>>('{"SANDMAN_SHIFT":"shift-1"}'),
  });
  expect(await bash($, 'git stash')).toMatchObject({
    deny: expect.stringContaining('never `git stash`'),
  });
  expect(runs[0]?.argv.slice(-'--shift shift-1'.split(' ').length)).toEqual(['--shift', 'shift-1']);
});

test('an allowed Bash call reaches the engine unchanged, and trails nothing', async ($, on) => {
  const { calls, runs } = engine(on);
  expect(await bash($, 'git stash list')).toMatchObject({ result: 'ran' });
  expect(calls).toEqual([expect.objectContaining({ command: 'git stash list', tool: 'Bash' })]);
  expect(runs).toEqual([]);
});

test('an Edit or Write to a .yml path is denied and trailed; .yaml goes on', async ($, on) => {
  const { calls, runs } = engine(on);
  const rule = 'YAML files end in `.yaml`, never `.yml` — rename on touch';
  const write = { content: '', file_path: '/r/.github/ci.YML', tool: 'Write' } as const;
  expect(await $.tool.call(write)).toMatchObject({ deny: `subether: ${rule}.` });
  expect(await $.tool.call(edit('/r/a.yml'))).toMatchObject({ deny: `subether: ${rule}.` });
  expect(runs.map(({ argv }) => argv[argv.indexOf('--rationale') + 1])).toEqual([
    `${rule}: /r/.github/ci.YML`,
    `${rule}: /r/a.yml`,
  ]);
  expect(await $.tool.call(edit('/r/ci.yaml'))).toMatchObject({ result: 'ran' });
  expect(calls).toEqual([expect.objectContaining({ file_path: '/r/ci.yaml' })]);
});

for (const [name, options, line] of [
  ['exits non-zero', { exitCode: 1 }, 'sandman trail append exited 1: boom'],
  ['cannot start', { isRefused: true }, expect.stringMatching(/^sandman trail append failed: /u)],
] as const) {
  test(`a trail that ${name} logs once and still denies`, async ($, on) => {
    const { logs } = engine(on, options);
    expect(await bash($, 'git push -f')).toMatchObject({
      deny: expect.stringContaining('never force-push'),
    });
    expect(logs).toEqual([line]);
  });
}

/**
The deny a guard that failed answers, its error's first line inside
*/
const UNREAD =
  'subether: the guard could not read this call (subether: $.session.id: no session) — it is denied, not run; rephrase the command';

for (const [tool, input] of [
  ['Bash', { command: 'git stash', tool: 'Bash' }],
  ['Edit', edit('/r/a.yml')],
] as const) {
  test(`a ${tool} guard that throws denies the call and trails one guard event`, async ($, on) => {
    const { calls, logs, runs } = engine(on, { failures: 1 });
    expect(await $.tool.call(input)).toEqual({ deny: UNREAD });
    expect(runs.map(({ argv }) => argv.slice(argv.indexOf('--kind') + 1))).toEqual([
      ['guard', '--rationale', UNREAD, '--ref', 'session:s1'],
    ]);
    expect(calls).toEqual([]);
    expect(logs).toEqual([]);
  });
}

test('a failed guard whose trail fails too still denies, logging once', async ($, on) => {
  const { calls, logs, runs } = engine(on, { failures: 2 });
  expect(await bash($, 'git stash')).toEqual({ deny: UNREAD });
  expect(runs).toEqual([]);
  expect(calls).toEqual([]);
  expect(logs).toEqual([expect.stringMatching(/^sandman trail append failed: /u)]);
});
