/**
The Bash guard, lifted from perpetual 0.2.12 (origin/main `plugins/perpetual/hooks/perpetual.mjs`: `commands`, `judge`,
`git`), typed, its logic unchanged: the command line tokenized as Bash would read it, each simple command's argv judged
against the house rules. What it cannot read it denies, by returning a reason, never by throwing. The `tool.call` hooks
deny a Bash command it judges, and an Edit/Write to a `.yml` path, trailing each denial
*/
import type { CatchHandler, EngineInterface, MatchedHook, ToolCallResult } from 'claude-code';
import { field } from './gauge';
import { trail } from './sandman';

/**
Bash commands the house rules forbid, by guard, each with the rule that forbids it
*/
const DENY = {
  checkout:
    'never mutate to inspect — `git checkout --`/`.`/`-f`/`<rev> <path>`/`--ours`/`--pathspec-from-file`, `git switch -f`, a worktree `git restore`, `git read-tree -u`/`--reset` and a `git -c alias.…` that can hide any of them discard every uncommitted change to the path, co-resident work included; undo your own edit by re-editing',
  clean: 'never mutate to inspect — `git clean` deletes untracked files, co-resident work included',
  deep: 'the guard cannot read a command nested this deep — split it into plain commands',
  force: 'never force-push — push a new branch or a new commit instead',
  pkill:
    "pkill -f matches every process's full argv — kill by resolved PID: `lsof -ti :<port>` or `pgrep -x <name>`, inspect, then `kill <pid>`",
  reset:
    'never mutate to inspect — `git reset --hard` discards the working tree; commit, or fast-forward with `git update-ref`',
  stash:
    'never `git stash` — the stash stack is shared across worktrees and sessions; set work aside with a WIP commit',
} as const;

type Guard = keyof typeof DENY;

/**
what a word is read as: a word of the command, a redirection's target, or `<<`'s (`<<-`'s) delimiter
*/
type Target = '' | 'file' | 'heredoc' | 'stripped';

/**
one open group's reading: the command being built in it and how its next character reads
*/
type Group = {
  argv: string[];
  /**
  `case` statements open in it, whose patterns end in `)`
  */
  cases: number;
  /**
  what ends it: `)`, a backtick, or nothing at the top
  */
  ender: '' | ')' | '`';
  /**
  inside `"…"`
  */
  isDq: boolean;
  /**
  every word of the current command so far is a keyword
  */
  isLead: boolean;
  /**
  the current word has a quoted part
  */
  isQuoted: boolean;
  /**
  subshells open inside it
  */
  parens: number;
  target: Target;
  /**
  undefined between words
  */
  word: string | undefined;
};

/**
a heredoc awaiting its body, read at the next newline
*/
type Heredoc = {
  delimiter: string;
  isQuoted: boolean;
  isStripped: boolean;
};

/**
one command line's tokenizing
*/
type Scan = {
  /**
  the groups enclosing the open one
  */
  frames: Group[];
  group: Group;
  heredocs: Heredoc[];
  /**
  `source` is an unquoted heredoc's body
  */
  isBody: boolean;
  out: string[][];
  source: string;
};

/**
an option grammar: the short options that take a value, and the long ones
*/
type Grammar = {
  long: readonly string[];
  takes: string;
};

/**
words that only open a statement; `function` also takes the name after it
*/
const KEYWORDS = new Set([
  '!',
  'coproc',
  'do',
  'elif',
  'else',
  'function',
  'if',
  'then',
  'until',
  'while',
  '{',
  '}',
]);
/**
a wrapper's positional words before the command it runs (`timeout 5`, `script -q <file>`)
*/
const LEADS: Readonly<Record<string, number>> = { gtimeout: 1, script: 1, timeout: 1 };
/**
long options of a wrapper that take a separate value
*/
const LONG = [
  '--adjustment',
  '--cd',
  '--chdir',
  '--close-from',
  '--env',
  '--group',
  '--host',
  '--jobs',
  '--kill-after',
  '--prompt',
  '--role',
  '--signal',
  '--type',
  '--user',
];
/**
how deep a command string may nest in another (`sh -c`, `eval`, `find -exec`, heredoc, `${…}`)
*/
const NEST = 16;
/**
how deep a group may nest in a line, four times NEST
*/
const GROUPS = 64;
/**
the longest redirection operator, `<<<`
*/
const OPERATOR_LENGTH = 3;
/**
commands that run the argv after their options, each with its short options that take a value
*/
const WRAPPERS: Readonly<Record<string, string>> = {
  builtin: '',
  caffeinate: 'tw',
  command: '',
  doas: 'Cu',
  env: 'CLPSUu',
  exec: 'a',
  gtimeout: 'ks',
  nice: 'n',
  nocorrect: '',
  noglob: '',
  nohup: '',
  parallel: 'j',
  script: 'Ft',
  stdbuf: 'eio',
  sudo: 'CDghpRrTtUu',
  time: 'fo',
  timeout: 'ks',
  watch: 'n',
  xargs: 'adEIJLnPRSs',
  xcrun: '',
};

const ALIAS_KEY = /^(?:alias|include(?:if)?)\./iu;
const ANSI = /\\(?<escape>x[\da-fA-F]{1,2}|u[\da-fA-F]{1,4}|[0-7]{1,3}|.)/gsu;
const ANSI_LETTERS = new Map([
  ['a', '\u{7}'],
  ['b', '\b'],
  ['e', '\u{1B}'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['v', '\v'],
]);
const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/u;
const BLANKS = ' \t\r';
const CASE_STEP = new Map([
  ['case', 1],
  ['esac', -1],
]);
const CHECKOUT_FLAG = /^--(?:f\w*|ours|theirs|pathspec-fr[\w-]*(?:=.*)?)$|^-[^-bB]*f/su;
const CHECKOUT_PATH = /^\.|^:\/?$|\/$|[*?[]/u;
const CLEAN_DRY = /^--d|^-[^-e]*n/u;
const COMMAND = /^command$/iu;
const CONFIG_FLAG = /^-c|^--config-env/u;
const DIGITS = /^\d+$/u;
const DQ_ESCAPES = '$`"\\\n';
const EXEC = /^-(?:exec|ok)(?:dir)?$/u;
const FORCE = /^--forc(?:e(?:-w[\w-]*)?)?(?:=|$)|^-[^-o]*f/u;
const GIT_VALUED =
  /^(?:-[Cc]|--(?:attr-source|config-env|git-dir|namespace|super-prefix|work-tree))$/u;
const HARD = /^--ha(?:rd?)?(?:=|$)/u;
const HEX = /^[xu]/u;
const INDEX_FORCE = /^--f|^-[^-]*f/u;
const INLINE_ALIAS =
  /^GIT_CONFIG_(?:KEY_\d+|PARAMETERS)=(?:.*[\s'"])?(?:alias|include(?:if)?)\./isu;
const INLINE_CONFIG = /^(?:-c|--config-env=)(?<value>.*)/su;
const LEADING_TABS = /^\t+/u;
const NAMES_ONLY = /^-[^-]*[vV]/u;
const NOTHING = /^$/u;
const OCTAL = /^[0-7]/u;
const OPERATOR = /^(?:<<<|<<-?|[<>&|]+)/u;
const OPERATORS = ';&|()';
const PKILL_FULL = /^--full$|^-[^-FGgJPstUu]*f/u;
const READ_TREE = /^--res|^-[^-]*u/u;
const RESTORE_STAGED = /^--st|^-[^-s]*S/u;
const RESTORE_WORKTREE = /^--w|^-[^-s]*W/u;
const SHELL = /^(?:ba|da|fi|k|z)?sh$/u;
const SHELL_COMMAND = /^-[^-]*c/u;
const STASH_READS = /^(?:list|show)$/u;
const SWITCH_FORCE = /^--(?:di[\w-]*|force)$|^-[^-cC]*f/u;
const TARGETS = new Map<string, Target>([
  ['<<', 'heredoc'],
  ['<<-', 'stripped'],
]);
const TOOL = /^(?:x|exec)$/u;
const TOOL_SPEC = /^[^-].*@/u;

/**
the option grammars: `mise`'s, and those of the Git subcommands and `pkill` the guard reads
*/
const CHECKOUT: Grammar = { long: ['--orphan'], takes: 'bB' };
const CHECKOUT_INDEX: Grammar = { long: ['--prefix'], takes: '' };
const CLEAN: Grammar = { long: ['--exclude'], takes: 'e' };
const MISE: Grammar = { long: LONG, takes: 'CEj' };
const PKILL: Grammar = { long: [], takes: 'FGgJPstUu' };
const PUSH: Grammar = { long: ['--push-option', '--repo'], takes: 'o' };
const READ: Grammar = { long: [], takes: '' };
const RESTORE: Grammar = { long: ['--source'], takes: 's' };
const SWITCH: Grammar = { long: [], takes: 'cC' };

const decodeEscape = (_match: string, escape: string): string => {
  if (HEX.test(escape)) {
    return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
  }
  if (OCTAL.test(escape)) {
    return String.fromCodePoint(Number.parseInt(escape, 8));
  }
  return ANSI_LETTERS.get(escape) ?? escape;
};

/**
Decodes a `$'…'` string's escapes.
*/
const ansi = (text: string): string =>
  text.replaceAll(ANSI, (match: string, escape: string) => decodeEscape(match, escape));

const basename = (word: string): string => word.slice(word.lastIndexOf('/') + 1).toLowerCase();

/**
the index of the `}` or `)` closing the group opened at `from`, or the end; only `${` nests a brace
*/
const closing = (source: string, from: number, pair: '()' | '{}'): number => {
  const [left, right] = pair;
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === left && (left === '(' || source[index - 1] === '$')) {
      depth += 1;
    } else if (source[index] === right) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return source.length;
};

/**
the end of the line at `from`: its newline's index, or the end
*/
const lineEnd = (source: string, from: number): number => {
  const at = source.indexOf('\n', from);
  return at === -1 ? source.length : at;
};

/**
where a heredoc's delimiter line starts, from its body's start `from`, or past the end
*/
const delimiterLine = (source: string, from: number, heredoc: Heredoc): number => {
  let at = from;
  while (at < source.length) {
    const eol = lineEnd(source, at);
    const line = source.slice(at, eol).replace(heredoc.isStripped ? LEADING_TABS : NOTHING, '');
    if (line === heredoc.delimiter) {
      return at;
    }
    at = eol + 1;
  }
  return at;
};

const fresh = (ender: Group['ender'], isDq: boolean): Group => ({
  argv: [],
  cases: 0,
  ender,
  isDq,
  isLead: true,
  isQuoted: false,
  parens: 0,
  target: '',
  word: undefined,
});

const add = (scan: Scan, text: string): void => {
  scan.group.word = (scan.group.word ?? '') + text;
};

/**
A command word: it counts a leading `case`/`esac`, and ends the lead once it is no keyword
*/
const keep = (group: Group, word: string): void => {
  if (group.isLead) {
    group.cases += CASE_STEP.get(word) ?? 0;
  }
  group.isLead &&= KEYWORDS.has(word);
  group.argv.push(word);
};

/**
Ends the current word: a heredoc's delimiter, a redirection's target (dropped), or the command's next word.
*/
const end = (scan: Scan): void => {
  const { group } = scan;
  const { target, word } = group;
  if (word === undefined) {
    return;
  }
  if (target === 'heredoc' || target === 'stripped') {
    scan.heredocs.push({
      delimiter: word,
      isQuoted: group.isQuoted,
      isStripped: target === 'stripped',
    });
  } else if (target === '') {
    keep(group, word);
  }
  group.target = '';
  group.isQuoted = false;
  group.word = undefined;
};

const flush = (scan: Scan): void => {
  end(scan);
  if (scan.group.argv.length > 0) {
    scan.out.push(scan.group.argv);
  }
  scan.group.argv = [];
  scan.group.isLead = true;
};

const open = (scan: Scan, by: Group['ender']): void => {
  if (scan.frames.length > GROUPS) {
    throw new RangeError('nested too deep');
  }
  scan.frames.push({ ...scan.group, word: scan.group.word ?? '' });
  scan.group = fresh(by, false);
};

/**
Closes the open group; its word in the enclosing command keeps a NUL in its place.
*/
const shut = (scan: Scan): void => {
  flush(scan);
  const prior = scan.frames.pop() ?? scan.group;
  scan.group = { ...prior, word: `${prior.word ?? ''}\0` };
};

/**
A backslash: the next character, quoted (in `"…"`, only before one of `` $`"\ `` and a newline).
*/
const escape = (scan: Scan, index: number): number | undefined => {
  if (scan.source[index] !== '\\') {
    return undefined;
  }
  const next = scan.source[index + 1];
  scan.group.isQuoted = true;
  if (scan.group.isDq && (next === undefined || !DQ_ESCAPES.includes(next))) {
    add(scan, '\\');
    return index;
  }
  if (next !== '\n') {
    add(scan, next ?? '');
  }
  return index + 1;
};

const backtick = (scan: Scan, index: number): number | undefined => {
  if (scan.source[index] !== '`') {
    return undefined;
  }
  if (scan.group.ender === '`' && !scan.group.isDq) {
    shut(scan);
  } else {
    open(scan, '`');
  }
  return index;
};

/**
Inside `"…"`, every character is the word's but the closing quote (in a heredoc's body, at the top, that too)
*/
const doubled = (scan: Scan, index: number): number | undefined => {
  if (!scan.group.isDq) {
    return undefined;
  }
  const char = scan.source.charAt(index);
  if (char !== '"' || (scan.isBody && scan.frames.length === 0)) {
    add(scan, char);
  } else {
    scan.group.isDq = false;
  }
  return index;
};

const opening = (scan: Scan, index: number): number | undefined => {
  if (scan.source[index] !== '"') {
    return undefined;
  }
  scan.group.isDq = true;
  scan.group.isQuoted = true;
  add(scan, '');
  return index;
};

/**
the index of the `'` closing a quote whose text starts at `from`, or the end; in `$'…'` an escape can hide one
*/
const quoteEnd = (source: string, from: number, isAnsi: boolean): number => {
  let at = from;
  while (at < source.length && source[at] !== "'") {
    at += isAnsi && source[at] === '\\' ? 2 : 1;
  }
  return at;
};

/**
`'…'`, and `$'…'`, which decodes its escapes
*/
const single = (scan: Scan, index: number): number | undefined => {
  const char = scan.source.charAt(index);
  const isAnsi = char === '$' && scan.source[index + 1] === "'";
  if (char !== "'" && !isAnsi) {
    return undefined;
  }
  const from = index + (isAnsi ? 2 : 1);
  const at = quoteEnd(scan.source, from, isAnsi);
  const text = scan.source.slice(from, at);
  add(scan, isAnsi ? ansi(text) : text);
  scan.group.isQuoted = true;
  return at;
};

/**
`<(…)` and `>(…)` open a group
*/
const substitution = (scan: Scan, index: number): number | undefined => {
  const char = scan.source.charAt(index);
  if ((char !== '<' && char !== '>') || scan.source[index + 1] !== '(') {
    return undefined;
  }
  end(scan);
  open(scan, ')');
  return index + 1;
};

/**
A redirection's fd (an unquoted number before it) is no word
*/
const dropFd = (group: Group): void => {
  if (group.word !== undefined && !group.isQuoted && DIGITS.test(group.word)) {
    group.word = undefined;
  }
};

/**
a redirection drops its fd and target; `<<` reads a heredoc
*/
const redirect = (scan: Scan, index: number): number | undefined => {
  const char = scan.source.charAt(index);
  if (char !== '<' && char !== '>' && (char !== '&' || scan.source[index + 1] !== '>')) {
    return undefined;
  }
  dropFd(scan.group);
  end(scan);
  const operator = OPERATOR.exec(scan.source.slice(index, index + OPERATOR_LENGTH))?.[0] ?? char;
  scan.group.target = TARGETS.get(operator) ?? 'file';
  return index + operator.length - 1;
};

/**
a `#` comment ends the line; a blank ends the word
*/
const blank = (scan: Scan, index: number): number | undefined => {
  const char = scan.source.charAt(index);
  if (char === '#' && scan.group.word === undefined) {
    return lineEnd(scan.source, index) - 1;
  }
  if (BLANKS.includes(char)) {
    end(scan);
    return index;
  }
  return undefined;
};

/**
`(` and `)` in a `$(…)`: a subshell opens or closes, a `case` pattern ends, else the group closes
*/
const subshell = (scan: Scan, index: number): number | undefined => {
  const char = scan.source.charAt(index);
  const { group } = scan;
  if ((char !== '(' && char !== ')') || group.ender !== ')') {
    return undefined;
  }
  if (char === '(') {
    group.parens += 1;
    flush(scan);
    return index;
  }
  // counts a pending `esac`
  end(scan);
  if (group.parens > 0) {
    group.parens -= 1;
    flush(scan);
  } else if (group.cases > 0) {
    flush(scan);
  } else {
    shut(scan);
  }
  return index;
};

const plain = (scan: Scan, index: number): number => {
  const char = scan.source.charAt(index);
  if (OPERATORS.includes(char)) {
    flush(scan);
  } else {
    add(scan, char);
  }
  return index;
};

/**
Whether option word `word` takes the next word as its value: a long one in `long`, or a short cluster ending in a
letter of `takes`.
*/
const isValued = (word: string, { long, takes }: Grammar): boolean => {
  if (word.startsWith('--')) {
    return long.includes(word);
  }
  const cluster = new RegExp(`^-[^-${takes}]*[${takes}]$`, 'u');
  return takes !== '' && cluster.test(word);
};

/**
the index past a wrapper's options from `from`, a value skipped, `--` consumed
*/
const optionsEnd = (argv: readonly string[], from: number, grammar: Grammar): number => {
  let at = from;
  for (let word = argv[at]; word !== '-' && word?.startsWith('-') === true; word = argv[at]) {
    if (word === '--') {
      return at + 1;
    }
    at += isValued(word, grammar) ? 2 : 1;
  }
  return at;
};

type Parts = { flags: string[]; isDd: boolean; pos: string[] };

/**
One argument into `parts`; resolves to how many words after it it takes as its value
*/
const sort = (parts: Parts, word: string, grammar: Grammar): number => {
  if (word === '-' || parts.isDd || !word.startsWith('-')) {
    parts.pos.push(word);
    return 0;
  }
  if (word === '--') {
    parts.isDd = true;
    return 0;
  }
  parts.flags.push(word);
  return isValued(word, grammar) ? 1 : 0;
};

/**
Splits arguments, options anywhere, into option words (`--` excluded) and positionals, a value skipped.
*/
const split = (words: readonly string[], grammar: Grammar): Parts => {
  const parts: Parts = { flags: [], isDd: false, pos: [] };
  for (let at = 0; at < words.length; at += 1) {
    at += sort(parts, words[at] ?? '', grammar);
  }
  return parts;
};

const hasFlag = (words: readonly string[], grammar: Grammar, pattern: RegExp): boolean =>
  split(words, grammar).flags.some((word) => pattern.test(word));

/**
the index past `mise`'s global options from `from`
*/
const miseEnd = (argv: readonly string[], from: number): number => {
  let at = from;
  for (let word = argv[at]; word?.startsWith('-') === true; word = argv[at]) {
    at += isValued(word, MISE) ? 2 : 1;
  }
  return at;
};

/**
the index of the command `mise x`/`exec` runs, from past its `x`: its options, tool specs (`node@22`) and `--`
*/
const toolEnd = (argv: readonly string[], from: number): number => {
  let at = optionsEnd(argv, from, MISE);
  while (TOOL_SPEC.test(argv[at] ?? '')) {
    at += 1;
  }
  return argv[at] === '--' ? at + 1 : at;
};

/**
The index of the command a wrapper or `mise x`/`exec` runs, past its options (`sudo -u me`, `mise x node@22 --`,
`timeout 5`); undefined when `name` is neither
*/
const wrapped = (argv: readonly string[], at: number, name: string): number | undefined => {
  const past = name === 'mise' ? miseEnd(argv, at + 1) : at + 1;
  const isTool = name === 'mise' && TOOL.test(argv[past] ?? '');
  if (!isTool && !Object.hasOwn(WRAPPERS, name)) {
    return undefined;
  }
  const grammar = { long: LONG, takes: WRAPPERS[name] ?? '' };
  const next = isTool ? toolEnd(argv, past + 1) : optionsEnd(argv, at + 1, grammar);
  return next + (Object.hasOwn(LEADS, name) ? (LEADS[name] ?? 0) : 0);
};

/**
the index past a `find -exec` command, at its `;` or `+`, or the end
*/
const execEnd = (argv: readonly string[], from: number): number => {
  let stop = from;
  while (stop < argv.length && argv[stop] !== ';' && argv[stop] !== '+') {
    stop += 1;
  }
  return stop;
};

/**
`-c`/`--config-env` setting an alias or include, its value `value`
*/
const isAliasing = (word: string, value: string | undefined): boolean =>
  CONFIG_FLAG.test(word) && ALIAS_KEY.test(value ?? '');

/**
Where the Git subcommand starts, past its global options, and whether an inline config (`-c`, `--config-env`) set an
alias or include; undefined for `--exec-path`, which prints the path and exits
*/
const gitStart = (
  words: readonly string[],
  isAlias: boolean,
): { at: number; isAlias: boolean } | undefined => {
  let at = 0;
  let isSet = isAlias;
  for (let word = words[at]; word?.startsWith('-') === true; word = words[at]) {
    if (word === '--exec-path') {
      return undefined;
    }
    const isValue = GIT_VALUED.test(word);
    isSet ||= isAliasing(word, isValue ? words[at + 1] : INLINE_CONFIG.exec(word)?.groups?.value);
    at += isValue ? 2 : 1;
  }
  return { at, isAlias: isSet };
};

const checkout = (rest: readonly string[]): Guard | undefined => {
  const { flags, pos } = split(rest, CHECKOUT);
  const isTripped =
    pos.length > 1 ||
    rest.includes('--') ||
    CHECKOUT_PATH.test(pos[0] ?? '') ||
    flags.some((word) => CHECKOUT_FLAG.test(word));
  return isTripped ? 'checkout' : undefined;
};

const push = (rest: readonly string[]): Guard | undefined => {
  const { flags, pos } = split(rest, PUSH);
  const isForced = flags.some((word) => FORCE.test(word));
  return isForced || pos.some((word) => word.startsWith('+')) ? 'force' : undefined;
};

/**
each Git subcommand's guard, by its arguments after the subcommand
*/
const SUBCOMMANDS = new Map<string, (rest: readonly string[]) => Guard | undefined>([
  ['checkout', checkout],
  [
    'checkout-index',
    (rest): Guard | undefined =>
      hasFlag(rest, CHECKOUT_INDEX, INDEX_FORCE) &&
      rest.every((word) => !word.startsWith('--prefix'))
        ? 'checkout'
        : undefined,
  ],
  ['clean', (rest): Guard | undefined => (hasFlag(rest, CLEAN, CLEAN_DRY) ? undefined : 'clean')],
  ['push', push],
  [
    'read-tree',
    (rest): Guard | undefined => (hasFlag(rest, READ, READ_TREE) ? 'checkout' : undefined),
  ],
  [
    'reset',
    (rest): Guard | undefined => (rest.some((word) => HARD.test(word)) ? 'reset' : undefined),
  ],
  [
    'restore',
    (rest): Guard | undefined =>
      hasFlag(rest, RESTORE, RESTORE_WORKTREE) || !hasFlag(rest, RESTORE, RESTORE_STAGED)
        ? 'checkout'
        : undefined,
  ],
  ['stash', (rest): Guard | undefined => (STASH_READS.test(rest[0] ?? '') ? undefined : 'stash')],
  [
    'switch',
    (rest): Guard | undefined => (hasFlag(rest, SWITCH, SWITCH_FORCE) ? 'checkout' : undefined),
  ],
]);

/**
The guard a Git invocation's arguments trip; `isAlias` when an inline config set an alias or include.
*/
const git = (words: readonly string[], isAlias: boolean): Guard | undefined => {
  const start = gitStart(words, isAlias);
  if (start === undefined) {
    return undefined;
  }
  if (start.isAlias) {
    return 'checkout';
  }
  const [sub = '', ...rest] = words.slice(start.at);
  if (rest[0] === '-h' || rest[0] === '--help') {
    return undefined;
  }
  return SUBCOMMANDS.get(sub)?.(rest);
};

/**
the commands judged by their arguments, each with its guard
*/
const JUDGED = new Map<string, (words: readonly string[], isAlias: boolean) => Guard | undefined>([
  ['git', git],
  [
    'pkill',
    (words): Guard | undefined => (hasFlag(words, PKILL, PKILL_FULL) ? 'pkill' : undefined),
  ],
]);

/**
Where the next word to judge is, past a `VAR=value` word, a keyword (`function` with its name) or a wrapper with its
options; past the end after `command -v`, which only names; undefined when the word at `at` is the command
*/
const advance = (argv: readonly string[], at: number, word: string): number | undefined => {
  if (ASSIGNMENT.test(word)) {
    return at + 1;
  }
  if (COMMAND.test(word) && NAMES_ONLY.test(argv[at + 1] ?? '')) {
    return argv.length;
  }
  if (KEYWORDS.has(word)) {
    return at + (word === 'function' ? 2 : 1);
  }
  return wrapped(argv, at, basename(word));
};

/**
One reading of a command line, and the depth its nested commands have reached: past NEST levels a read throws, and
`decide` denies
*/
class Reader {
  private depth = 0;

  /**
  Splits a Bash command line into the argv of every simple command it runs, each word after quote removal: a `$(…)`,
  backtick or `<(…)` group is a command of its own (its word keeps a NUL in its place), a redirection and its target
  drop out, a heredoc's body is skipped (an unquoted one's groups still run), a `#` comment ends the line. `isBody`
  reads `source` as an unquoted heredoc's body. One pass, no backtracking; an unclosed quote or group runs to the end.
  */
  public commands(source: string, isBody: boolean): string[][] {
    const scan: Scan = {
      frames: [],
      group: fresh('', isBody),
      heredocs: [],
      isBody,
      out: [],
      source,
    };
    let index = 0;
    while (index < source.length) {
      index = this.step(scan, index) + 1;
    }
    while (scan.frames.length > 0) {
      shut(scan);
    }
    flush(scan);
    return scan.out;
  }

  /**
  The first guard any command in a Bash command line trips.
  */
  public verdict(source: string): Guard | undefined {
    for (const argv of this.commands(source, false)) {
      const found = this.judge(argv);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  /**
  where the `((` at `index` ends if it is arithmetic (it closes with `))`, or never), its groups run; else -1
  */
  private arithmetic(scan: Scan, index: number): number {
    const at = closing(scan.source, index, '()');
    if (at < scan.source.length && scan.source[at - 1] !== ')') {
      return -1;
    }
    this.text(scan, index + 2, at - 1);
    return at;
  }

  /**
  an array literal, `a=(…)`, its groups run
  */
  private array(scan: Scan, index: number): number | undefined {
    if (scan.source[index] !== '(' || scan.group.word?.endsWith('=') !== true) {
      return undefined;
    }
    const at = closing(scan.source, index, '()');
    this.text(scan, index + 1, at);
    add(scan, '\0');
    return at;
  }

  /**
  `${…}`, its groups run
  */
  private brace(scan: Scan, index: number): number | undefined {
    if (scan.source[index] !== '$' || scan.source[index + 1] !== '{') {
      return undefined;
    }
    const at = closing(scan.source, index + 1, '{}');
    this.text(scan, index + 2, at);
    add(scan, scan.source.slice(index, at + 1));
    return at;
  }

  /**
  the guard the command at `at` trips: an `eval`, `sh -c` or `find -exec` reads on, `git` and `pkill` judge
  */
  private command(argv: readonly string[], at: number, isAlias: boolean): Guard | undefined {
    const name = basename(argv[at] ?? '');
    if (name === 'eval') {
      return this.evaluated(argv, at);
    }
    if (SHELL.test(name)) {
      return this.shell(argv, at);
    }
    const found = name === 'find' ? this.found(argv, at) : undefined;
    if (found !== undefined) {
      return found;
    }
    return JUDGED.get(name)?.(argv.slice(at + 1), isAlias);
  }

  /**
  `$(…)`: `$((…))` arithmetic, or `$((cmd) …)`, a group opening a subshell
  */
  private dollar(scan: Scan, index: number): number | undefined {
    if (scan.source[index] !== '$' || scan.source[index + 1] !== '(') {
      return undefined;
    }
    const at = scan.source[index + 2] === '(' ? this.arithmetic(scan, index + 1) : -1;
    if (at >= 0) {
      add(scan, '\0');
      return at;
    }
    open(scan, ')');
    return index + 1;
  }

  /**
  `((…))` arithmetic opening a command, whose `<<` is a shift
  */
  private doubleParen(scan: Scan, index: number): number | undefined {
    const { group, source } = scan;
    const isBare = group.word === undefined && group.argv.length === 0;
    if (!isBare || source[index] !== '(' || source[index + 1] !== '(') {
      return undefined;
    }
    return this.arithmetic(scan, index) >= 0 ? closing(source, index, '()') : undefined;
  }

  /**
  `eval`'s words, past any further `eval`, read as a command line
  */
  private evaluated(argv: readonly string[], at: number): Guard | undefined {
    let past = at + 1;
    while (argv[past]?.toLowerCase() === 'eval') {
      past += 1;
    }
    const line = argv.slice(past).join(' ');
    return this.nested(() => this.verdict(line));
  }

  /**
  the guard a `find`'s `-exec`/`-ok` commands trip
  */
  private found(argv: readonly string[], at: number): Guard | undefined {
    for (let next = at + 1; next < argv.length; next += 1) {
      if (!EXEC.test(argv[next] ?? '')) {
        continue;
      }
      const stop = execEnd(argv, next + 1);
      const found = this.judged(argv.slice(next + 1, stop));
      if (found !== undefined) {
        return found;
      }
      next = stop;
    }
    return undefined;
  }

  /**
  The guard one command's argv trips: past `VAR=value` words, keywords and wrappers with their options, the command
  word matched by basename (a case-insensitive filesystem runs `GIT` as Git). An inline
  `GIT_CONFIG_KEY_<n>=alias.…` counts as `git -c alias.…`.
  */
  private judge(argv: readonly string[]): Guard | undefined {
    let isAlias = false;
    let at = 0;
    for (let word = argv[at]; word !== undefined; word = argv[at]) {
      // only a `VAR=value` word matches
      isAlias ||= INLINE_ALIAS.test(word);
      const past = advance(argv, at, word);
      if (past === undefined) {
        return this.command(argv, at, isAlias);
      }
      at = past;
    }
    return undefined;
  }

  private judged(argv: readonly string[]): Guard | undefined {
    return this.nested(() => this.judge(argv));
  }

  /**
  Reads one level deeper into a nested command; past NEST levels it throws.
  */
  private nested<T>(read: () => T): T {
    if (this.depth >= NEST) {
      throw new RangeError('nested too deep');
    }
    this.depth += 1;
    try {
      return read();
    } finally {
      this.depth -= 1;
    }
  }

  /**
  A newline ends the command; the heredocs it opened are read, an unquoted one's groups run.
  */
  private newline(scan: Scan, index: number): number | undefined {
    if (scan.source[index] !== '\n') {
      return undefined;
    }
    flush(scan);
    // where the next body starts
    let body = index + 1;
    for (const heredoc of scan.heredocs.splice(0)) {
      const at = delimiterLine(scan.source, body, heredoc);
      if (!heredoc.isQuoted) {
        this.text(scan, body, at);
      }
      body = lineEnd(scan.source, at) + 1;
    }
    return body - 1;
  }

  /**
  `sh -c`'s string (bash, dash, fish, ksh, zsh too), read as a command line; a shell running a file passes
  */
  private shell(argv: readonly string[], at: number): Guard | undefined {
    const flag = argv.findIndex((word, next) => next > at && SHELL_COMMAND.test(word));
    return flag === -1 ? undefined : this.nested(() => this.verdict(argv[flag + 1] ?? ''));
  }

  /**
  reads the character at `index`, and resolves to the index of the last it consumed
  */
  private step(scan: Scan, index: number): number {
    return (
      escape(scan, index) ??
      this.brace(scan, index) ??
      this.dollar(scan, index) ??
      backtick(scan, index) ??
      doubled(scan, index) ??
      opening(scan, index) ??
      single(scan, index) ??
      substitution(scan, index) ??
      redirect(scan, index) ??
      blank(scan, index) ??
      this.array(scan, index) ??
      this.doubleParen(scan, index) ??
      subshell(scan, index) ??
      this.newline(scan, index) ??
      plain(scan, index)
    );
  }

  /**
  reads `source[from, to)` as text whose groups still run (`${…}`, an array literal, a heredoc's body)
  */
  private text(scan: Scan, from: number, to: number): void {
    const body = scan.source.slice(from, to);
    scan.out.push(...this.nested(() => this.commands(body, true)));
  }
}

const verdict = (command: string): Guard | undefined => {
  const reader = new Reader();
  return reader.verdict(command);
};

/**
The house rule a Bash command line breaks, as the reason to deny it; what the guard cannot read it cannot pass.
*/
const decide = (command: string): string | undefined => {
  let guard: Guard | undefined = 'deep';
  try {
    guard = verdict(command);
  } catch {
    // nested past the limits, or unreadable
  }
  return guard === undefined ? undefined : DENY[guard];
};

/**
how much of the denied command or path the trail's rationale carries
*/
const RATIONALE = 200;
const YML = /\.yml$/iu;
const YML_RULE = 'YAML files end in `.yaml`, never `.yml` — rename on touch';

/**
A rejection's message, else its text
*/
const messageOf = (error: unknown): string => {
  const message = field(error, 'message');
  return typeof message === 'string' ? message : String(error);
};

/**
The deny of a call the guard failed on before it passed the call on, trailed with the same text; a failed trail is one log line
*/
const unread = async ($: EngineInterface, why: string): Promise<ToolCallResult> => {
  const text = `subether: the guard could not read this call (${why.split('\n', 1)[0] ?? ''}) — it is denied, not run; rephrase the command`;
  await trail($, 'guard', text).catch((error: unknown) => {
    $.ui.log(`subether: sandman trail append failed: ${String(error)}`);
  });
  return { deny: text };
};

/**
Trails the denial (`sandman trail append --kind guard`, a failed run one log line) and denies with the house rule; a trail that rejects (a `$` call refused) fails the guard, which denies all the same. Caught here, not left to the `.catch` handler: in the kit a rejection under the tool log's hook, which wraps this one, fails that hook instead
*/
const refuse = async (
  $: EngineInterface,
  reason: string,
  subject: string,
): Promise<ToolCallResult> =>
  await trail($, 'guard', `${reason}: ${subject.slice(0, RATIONALE)}`)
    .then((): ToolCallResult => ({ deny: `subether: ${reason}.` }))
    .catch(async (error: unknown) => await unread($, messageOf(error)));

/**
A Bash command the house rules forbid is denied; any other goes on unchanged
*/
const bash: MatchedHook<'tool.call', { tool: 'Bash' }> = async ($, e, next) => {
  const reason = decide(e.command);
  return reason === undefined ? await next(e) : await refuse($, reason, e.command);
};

/**
An Edit or Write to a `.yml` path is denied; any other goes on unchanged
*/
const yml: MatchedHook<'tool.call', { tool: ['Edit', 'Write'] }> = async ($, e, next) =>
  YML.test(e.file_path) ? await refuse($, YML_RULE, e.file_path) : await next(e);

/**
Fail closed: a guard that threw or timed out before it called `next` denies the call (`Caught.called`, `Caught.error`:
d.ts 1218–1229, `HookFailure` 5370–5386); one that failed after keeps what `next` settled to
*/
const bashFailed: CatchHandler<typeof bash> = async ($, e, next) =>
  next.called ? await next(e) : await unread($, next.error.message ?? next.error.kind);

const ymlFailed: CatchHandler<typeof yml> = async ($, e, next) =>
  next.called ? await next(e) : await unread($, next.error.message ?? next.error.kind);

export { bash, bashFailed, decide, yml, ymlFailed };
