/**
The right pane, docs/recall.html#pane: a row per recall, the seed and each pull, newest first and open; open, its path
(the scorer, or the cut without one) and a failed stage's cause, the seed's due work and always-set, and its sent lines
by bank or topic, each pressed open to its description and the verb that reads it
*/
import {
  type MatchedHook,
  type RenderElement,
  type StateDollar,
  atom,
  read,
  update,
} from 'claude-code';

const recalls = atom({ key: 'recalls', plugin: 'subether' } as const, []);
const toggled = atom({ key: 'toggled', plugin: 'subether' } as const, []);

/**
how much of a cue a row's header shows
*/
const CUE = 28;
const MS = 1000;
const PANE = { id: 'subether', title: 'subether · recall' };
/**
the gauge's red, for a failure and its cause
*/
const RED = '#ff5f5f';
/**
the gauge's orange, for an overdue date
*/
const WARN = '#ff8700';
/**
the who column's width
*/
const WHO = 'agent'.length;

const TOPIC = /^(?:knowledge\/|traces\/@)(?<topic>[^/]+)\//u;

/**
A sent line's group: a knowledge page's or playbook's topic, page or trace, else its bank, the path less the file
*/
const groupOf = (path: string): string => {
  const topic = TOPIC.exec(path)?.groups?.topic;
  return topic === undefined ? path.slice(0, path.lastIndexOf('/')) : `knowledge · ${topic}`;
};

const zoned = (at: number): Temporal.ZonedDateTime =>
  Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(Temporal.Now.timeZoneId());

type Due = { after?: string; date?: string; id: string; what: string };
type Entry = {
  about: string;
  mark: string;
  name: string;
  path: string;
  score?: string;
  type: string;
};
type Parts = {
  always: Entry[];
  cause: string | undefined;
  due: Due[];
  head: { by: string; cue: string; of: number; sent: number } | undefined;
  me: string;
  more: string | undefined;
  ms: string | undefined;
  none: string | undefined;
  sent: Entry[];
};

const DUE =
  /^ {2}· (?<id>[\da-f]{8}) (?:(?<date>\d{4}-\d\d-\d\d)|waiting: (?<after>.*?)) — (?<what>.*)$/u;
const ENTRY =
  /^(?: {2}· |(?<score>\d?\.\d\d) )(?<mark>~?)(?<name>.*?) \((?<type>\w+) · (?<path>\S+)\) — (?<about>.*)$/u;
const HEAD = /^recall · (?<cue>.*?) · (?<sent>\d+) of (?<of>\d+)(?: · (?<by>.*))?$/u;

/**
One recall's stderr and text read back into its parts: the header (cue, sent, considered, path), the due rows (`<id> <date>|waiting: <event> — <what>`) and how many more, the always-set and the sent lines (`<score> <~><name> (<type> · <path>) — <about>`, the always-set's unscored), a failed stage's cause, the wall time, the binary the footer names, and why no line was sent
*/
const parse = (text: string, stderr = ''): Parts => {
  const lines = `${stderr}\n${text}`.split('\n');
  const find = (pattern: RegExp): string | undefined =>
    lines.map((line) => pattern.exec(line)?.groups?.hit).find((hit) => hit !== undefined);
  const rows = <T extends object>(pattern: RegExp, fill: T, from = lines): T[] =>
    from.flatMap((line): T[] => {
      const groups = pattern.exec(line)?.groups;
      return groups === undefined ? [] : [{ ...fill, ...groups }];
    });
  const entries = rows<Entry>(
    ENTRY,
    { about: '', mark: '', name: '', path: '', type: '' },
    lines.filter((line) => !DUE.test(line)),
  );
  const head = lines.map((line) => HEAD.exec(line)?.groups).find((groups) => groups !== undefined);
  return {
    always: entries.filter(({ score }) => score === undefined),
    cause: find(/^sandman recall: (?<hit>.*)$/u),
    due: rows<Due>(DUE, { id: '', what: '' }),
    head: head && {
      by: head.by ?? '—',
      cue: head.cue ?? '',
      of: Number(head.of),
      sent: Number(head.sent),
    },
    me: find(/^read one in full: (?<hit>\S+) show/u) ?? 'sandman-next',
    more: find(/^ {2}… (?<hit>\d+) more: /u),
    ms: find(/ ms=(?<hit>\d+)/u),
    none: find(/^(?<hit>nothing recalled.*)$/u),
    sent: entries.filter(({ score }) => score !== undefined),
  };
};

/**
A header's press: flip its row from its default
*/
const toggle = ($: StateDollar, key: string) => async (): Promise<void> => {
  await update($, toggled, (keys) =>
    keys.includes(key) ? keys.filter((other) => other !== key) : [...keys, key],
  );
};

/**
`/subether` opens the pane asked, so it places at any width
*/
const command: MatchedHook<'command.run', { command: 'subether' }> = async ($) => {
  await $.ui.open(PANE);
  return {};
};

/**
At an interactive session's start: open the pane unasked (placed from 144 columns, else it waits undrawn), then register `/subether`, last as a refusal skips the rest of the hook
*/
const opening: MatchedHook<'session.start', { isInteractive: true }> = async ($, e, next) => {
  await $.ui.open(PANE);
  await $.command.register({
    description: "Open the subether pane: the session's memory recalls",
    immediate: true,
    name: PANE.id,
  });
  return await next(e);
};

const pane: MatchedHook<'ui.render', { component: 'Pane' }> = async ($, e, next) => {
  if (e.requestId !== PANE.id) {
    return await next(e);
  }
  const [all, flipped] = await Promise.all([read($, recalls), read($, toggled)]);
  const { Box, Button, Text } = $.ui.resolve(e);
  const rows = all
    .toReversed()
    .map((recall) => [recall, parse(recall.text, recall.stderr)] as const);
  const sent = rows.reduce((sum, [, parts]) => sum + parts.sent.length, 0);
  const newest = `recall:${rows[0]?.[0].at}`;
  const isOpen = (key: string): boolean =>
    flipped.includes(key) !== (key === newest || key.endsWith(':due'));
  const pressable = (key: string, label: string, indent = ''): RenderElement => (
    <Button key={key} onPress={toggle($, key)} plain>
      <Text weight="bold">{`${indent}${isOpen(key) ? '▾' : '▸'} ${label}`}</Text>
    </Button>
  );
  return (
    <Box flexDirection="column" width={e.props.bodyColumns}>
      <Text weight="bold">{`recall · ${rows.length} pull${rows.length === 1 ? '' : 's'} · ${sent} sent`}</Text>
      {rows.length === 0 && <Text dimColor>{'nothing yet — the first prompt seeds it'}</Text>}
      {rows.map(
        ([{ at, error, who }, { always, cause, due, head, me, more, ms, none, sent: lines }]) => {
          const key = `recall:${at}`;
          const cue =
            head === undefined
              ? ''
              : `${head.cue.slice(0, CUE)}${head.cue.length > CUE ? '…' : ''}`;
          const seconds = ms === undefined ? '' : ` · ${(Number(ms) / MS).toFixed(1)} s`;
          const today = zoned(at).toPlainDate().toString();
          return (
            <Box flexDirection="column" key={`row:${key}`}>
              {pressable(
                key,
                `${zoned(at).toPlainTime().toString({ smallestUnit: 'minute' })}  ${who.padEnd(WHO)}  ${error === undefined ? `${cue}  ${lines.length} sent` : 'failed'}`,
              )}
              {isOpen(key) && (
                <Box flexDirection="column">
                  {error !== undefined && <Text color={RED}>{`  ${error}`}</Text>}
                  {head !== undefined && <Text dimColor>{`  ${head.by}${seconds}`}</Text>}
                  {cause !== undefined && <Text color={RED}>{`  ${cause}`}</Text>}
                  {due.length > 0 &&
                    pressable(`${key}:due`, `due · ${due.length + Number(more ?? 0)}`, '  ')}
                  {isOpen(`${key}:due`) && (
                    <Box flexDirection="column">
                      {due.map(({ after, date, id, what }) => (
                        <Text color={(date ?? today) < today ? WARN : undefined} key={id}>
                          {`      ${id} ${date ?? `waiting: ${after}`} — ${what}`}
                        </Text>
                      ))}
                      {more !== undefined && (
                        <Text dimColor>{`      … ${more} more: ${me} due`}</Text>
                      )}
                    </Box>
                  )}
                  {always.length > 0 &&
                    pressable(`${key}:always`, `always · ${always.length}`, '  ')}
                  {isOpen(`${key}:always`) && (
                    <Box flexDirection="column">
                      {always.map(({ mark, name, path, type }) => (
                        <Text key={path}>{`      ${mark}${name}  ${type}`}</Text>
                      ))}
                    </Box>
                  )}
                  {[...new Set(lines.map(({ path }) => groupOf(path)))].map((group) => (
                    <Box flexDirection="column" key={`${key}:${group}`}>
                      <Text dimColor>{`  ${group}`}</Text>
                      {lines
                        .filter(({ path }) => groupOf(path) === group)
                        .map(({ about, mark, name, path, score, type }) => (
                          <Box flexDirection="column" key={`box:${key}:${path}`}>
                            {pressable(`${key}:${path}`, `${score} ${mark}${name}  ${type}`, '  ')}
                            {isOpen(`${key}:${path}`) && (
                              <Text dimColor>{`      ${about}\n      ${me} show ${path}`}</Text>
                            )}
                          </Box>
                        ))}
                    </Box>
                  ))}
                  {head !== undefined && (
                    <Text dimColor>{`  considered, not sent: ${head.of - head.sent}`}</Text>
                  )}
                  {none !== undefined && <Text dimColor>{`  ${none}`}</Text>}
                </Box>
              )}
            </Box>
          );
        },
      )}
    </Box>
  );
};

export { command, opening, pane };
