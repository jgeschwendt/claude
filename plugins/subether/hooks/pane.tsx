/**
The right pane: the judges' availability, then each context block subether attached and each prompt it judged, newest first, collapsed to its header
*/
import {
  type MatchedHook,
  type PluginState,
  type StateDollar,
  atom,
  read,
  update,
} from 'claude-code';
import { probe } from './judge';

type Availability = PluginState['subether']['gate']['kev'];
type Judged = PluginState['subether']['judged'][number];

const expanded = atom({ key: 'expanded', plugin: 'subether' } as const, []);
const gate = atom({ key: 'gate', plugin: 'subether' } as const, {
  kev: { why: '' },
  typesafe: { why: '' },
});
const injected = atom({ key: 'injected', plugin: 'subether' } as const, []);
const judged = atom({ key: 'judged', plugin: 'subether' } as const, []);

/**
how much of a judged prompt its header shows
*/
const CUT = 40;
const PANE = { id: 'subether', title: 'subether · injected' };

const hhmm = (at: number): string =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });

/**
`typesafe up`, `kev down (key refused (401))` for the session, `typesafe down until 14:32 (rate limited)`; one whose `until` passed is tried again, so up
*/
const availability = (name: string, { until = 0, why }: Availability, now: number): string => {
  if (until <= now) {
    return `${name} up`;
  }
  return until === Number.MAX_SAFE_INTEGER
    ? `${name} down (${why})`
    : `${name} down until ${hhmm(until)} (${why})`;
};

/**
A judged prompt's header: its head on one line, cut at 40, and its likeliest marker
*/
const judgedHeader = ({ at, head, judge, markers }: Judged): string => {
  const line = head.replaceAll(/\s+/gu, ' ');
  const shown = line.length > CUT ? `${line.slice(0, CUT)}…` : line;
  const [top] = Object.entries(markers).toSorted(([, one], [, other]) => other - one);
  const verdict =
    judge === undefined || top === undefined ? 'no judge' : `${top[0]} ${top[1].toFixed(2)}`;
  return `${hhmm(at)} · judged · ${shown} · ${verdict}`;
};

/**
A judged prompt's body: each marker's probability, then who judged it at what input-token cost
*/
const judgedBody = ({ judge, markers, tokens }: Judged): string[] =>
  judge === undefined
    ? ['no judge answered']
    : [
        ...Object.entries(markers)
          .toSorted(([one], [other]) => one.localeCompare(other))
          .map(([name, odds]) => `${name} ${odds.toFixed(2)}`),
        `by ${judge}${tokens === undefined ? '' : `, ${tokens} input tokens`}`,
      ];

/**
A header's press: expand its row, or collapse it again
*/
const toggle = ($: StateDollar, key: string) => async (): Promise<void> => {
  await update($, expanded, (keys) =>
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
At an interactive session's start: probe the judges unawaited (only an interactive session takes composer prompts, so only one is judged), open the pane unasked (placed from 144 columns, else it waits undrawn), then register `/subether`, last as a refusal skips the rest of the hook
*/
const opening: MatchedHook<'session.start', { isInteractive: true }> = async ($, e, next) => {
  probe($).catch((error: unknown) => {
    $.ui.log(`judge: probe: ${String(error)}`);
  });
  await $.ui.open(PANE);
  await $.command.register({
    description: 'Open the subether pane: the context subether injected',
    immediate: true,
    name: PANE.id,
  });
  return await next(e);
};

const pane: MatchedHook<'ui.render', { component: 'Pane' }> = async ($, e, next) => {
  if (e.requestId !== PANE.id) {
    return await next(e);
  }
  const [blocks, judges, open, prompts, now] = await Promise.all([
    read($, injected),
    read($, gate),
    read($, expanded),
    read($, judged),
    $.clock.now(),
  ]);
  const { Box, Button, Text } = $.ui.resolve(e);
  const rows = [
    ...blocks.toReversed().map(({ at, chars, cut, error, source, text }) => ({
      body: [error ?? text],
      header: `${hhmm(at)} · ${source} · ${error === undefined ? `${chars} chars${cut ? ', cut' : ''}` : 'failed'}`,
      key: `injected:${at}`,
    })),
    ...prompts.toReversed().map((prompt) => ({
      body: judgedBody(prompt),
      header: judgedHeader(prompt),
      key: `judged:${prompt.at}`,
    })),
  ];
  return (
    <Box flexDirection="column" width={e.props.bodyColumns}>
      <Text dimColor>
        {`judge · ${availability('typesafe', judges.typesafe, now)} · ${availability('kev', judges.kev, now)}`}
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>{'nothing injected yet — the first prompt attaches sandman recall'}</Text>
      ) : (
        rows.map(({ body, header, key }) => (
          <Box flexDirection="column" key={`row:${key}`}>
            <Button key={key} onPress={toggle($, key)} plain>
              <Text weight="bold">{`${open.includes(key) ? '▾' : '▸'} ${header}`}</Text>
            </Button>
            {open.includes(key) && (
              <>
                <Text dimColor>{body.join('\n')}</Text>
                <Text> </Text>
              </>
            )}
          </Box>
        ))
      )}
    </Box>
  );
};

export { command, opening, pane };
