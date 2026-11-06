/**
The right pane: each context block subether attached, newest first, collapsed to its header
*/
import { type MatchedHook, type StateDollar, atom, read, update } from 'claude-code';

const expanded = atom({ key: 'expanded', plugin: 'subether' } as const, []);
const injected = atom({ key: 'injected', plugin: 'subether' } as const, []);

const PANE = { id: 'subether', title: 'subether · injected' };

const hhmm = (at: number): string =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });

/**
A header's press: expand its row, or collapse it again
*/
const toggle = ($: StateDollar, at: number) => async (): Promise<void> => {
  await update($, expanded, (ats) =>
    ats.includes(at) ? ats.filter((other) => other !== at) : [...ats, at],
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
At an interactive session's start: open the pane unasked (placed from 144 columns, else it waits undrawn), then
register `/subether`, last as a refusal skips the rest of the hook
*/
const opening: MatchedHook<'session.start', { isInteractive: true }> = async ($, e, next) => {
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
  const blocks = await read($, injected);
  const open = await read($, expanded);
  const { Box, Button, Text } = $.ui.resolve(e);
  return (
    <Box flexDirection="column" width={e.props.bodyColumns}>
      {blocks.length === 0 ? (
        <Text dimColor>{'nothing injected yet — the first prompt attaches sandman recall'}</Text>
      ) : (
        blocks.toReversed().map(({ at, chars, cut, error, source, text }) => (
          <Box flexDirection="column" key={String(at)}>
            <Button key={`injected:${at}`} onPress={toggle($, at)} plain>
              <Text weight="bold">
                {`${open.includes(at) ? '▾' : '▸'} ${hhmm(at)} · ${source} · ${error === undefined ? `${chars} chars${cut ? ', cut' : ''}` : 'failed'}`}
              </Text>
            </Button>
            {open.includes(at) && (
              <>
                <Text dimColor>{error ?? text}</Text>
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
