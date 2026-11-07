/**
The gauge row under the prompt: the retired Rust statusline's line (docs/subether.html#gauge), drawn at the hint line's site
instead of a statusLine command, the engine's hint kept beneath.
*/
import {
  type EngineInterface,
  type Hook,
  type MatchedHook,
  type PluginState,
  type SessionUsage,
  type StreamHook,
  atom,
  read,
  update,
} from 'claude-code';

type Gauge = PluginState['subether']['gauge'];
type Samples = PluginState['subether']['samples'];

const effort = atom({ key: 'effort', plugin: 'subether' } as const, '');
const gauge = atom({ key: 'gauge', plugin: 'subether' } as const, {
  model: '',
  threshold: 0,
  window: 0,
});
const samples = atom({ key: 'samples', plugin: 'subether' } as const, []);

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const BAR = 20;
const CELL = 8;
const CENT_HALF = 0.005;
const DIAL = 12;
const ETA_AT = 50;
const LIVE_SECONDS = 21_600;
const LONG_CONTEXT = 200_000;
// src/statusline.rs MARGIN: the row's printable region is narrower than the terminal, or it clips with `…`
const MARGIN = 4;
const MINUTE = 60;
// the engine's permission-mode label at the head of the hint line, hidden: the row's flags say `auto` instead
// (owner 2026-11-06: "hide that label if you can")
const MODE = /^⏵⏵ auto mode on(?: \([^)]*\))?(?: · )?/u;
const MS = 1000;
const PERCENT = 100;
const POLL_EVERY = 15_000;
const SAMPLES_KEPT = 40;
const ORANGE_AT = 75;
const RED_AT = 90;
const YELLOW_AT = 50;

const clamp = (pct: number): number => Math.min(PERCENT, Math.max(0, pct));

/**
Unix seconds → local wall clock `10:50pm`
*/
const clock = (at: number): string => {
  const time = Temporal.Instant.fromEpochMilliseconds(at * MS).toZonedDateTimeISO(
    Temporal.Now.timeZoneId(),
  );
  const minute = String(time.minute).padStart(2, '0');
  return `${time.hour % DIAL || DIAL}:${minute}${time.hour < DIAL ? 'am' : 'pm'}`;
};

/**
Seconds → `2h13m`, `40m`; rounded to minutes first, so 59.9m reads `1h0m`
*/
const dur = (seconds: number): string => {
  const minutes = Math.max(1, Math.round(seconds / MINUTE));
  return minutes < MINUTE ? `${minutes}m` : `${Math.floor(minutes / MINUTE)}h${minutes % MINUTE}m`;
};

/**
Time to auto-compact from the retained trend, ` ≈40m`: under a minute of trend is noise, past the
threshold there is nothing to project, and an idle session's decaying rate hides beyond 6h
*/
const etaOf = (trend: Samples, tokens: number, threshold: number): string => {
  const [first, last] = [trend[0], trend.at(-1)];
  if (first === undefined || last === undefined) {
    return '';
  }
  const span = (last.at - first.at) / MS;
  const left = ((threshold - tokens) * span) / (last.tokens - first.tokens);
  const isProjected = last.tokens > first.tokens && span >= MINUTE && left > 0;
  return isProjected && left < LIVE_SECONDS ? ` ≈${dur(left)}` : '';
};

const isLive = (at: number, now: number): boolean => {
  const left = at - Math.floor(now / MS);
  return left >= 1 && left <= LIVE_SECONDS;
};

/**
Muted green → yellow (50) → orange (75) → red (90): xterm-256 108/179/208/203
*/
const tone = (pct: number): string => {
  if (pct >= RED_AT) {
    return '#ff5f5f';
  }
  if (pct >= ORANGE_AT) {
    return '#ff8700';
  }
  return pct >= YELLOW_AT ? '#d7af5f' : '#87af87';
};

/**
`value[key]` of a parsed JSON value, `undefined` off an object
*/
const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

/**
`claude-haiku-5-5` → `Haiku 5.5`, `claude-opus-5-5[1m]` → `Opus 5.5[1m]`; any other id as is
*/
const pretty = (model: string): string => {
  const id = /^claude-(?<family>[a-z]+)-(?<major>\d+)-(?<minor>\d+)/u.exec(model);
  if (id?.groups === undefined) {
    return model;
  }
  const { family = '', major = '', minor = '' } = id.groups;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
  return `${name}${model.slice(id[0].length)}`;
};

const present = (value: string | undefined): string | undefined =>
  value === '' ? undefined : value;

/**
Payload text never reaches the row as an escape
*/
const printable = (text: string): string => text.replaceAll(/\p{Cc}/gu, '');

/**
The row's text, segment by segment (absent data leaves `""`), and the two tones
*/
/**
The row's flags: the effort level unless it is the default `high`, and `auto` while the engine's
permission-mode label is hidden from the hint line
*/
const flagsOf = (level: string, isAuto: boolean): string[] => {
  const flag = printable(level);
  return [...(flag === '' || flag === 'high' ? [] : [flag]), ...(isAuto ? ['auto'] : [])];
};

const segments = (
  reading: Gauge,
  flags: string[],
  trend: Samples,
): { pct: number; text: Record<string, string>; used: number } => {
  const { five, threshold, usd } = reading;
  const tokens = reading.tokens ?? 0;
  const pct = clamp(Math.round((tokens / threshold) * PERCENT));
  const used = clamp(Math.floor(five?.used ?? 0));
  const tier = tokens > LONG_CONTEXT ? '†' : '';
  const reset = five?.resetsAt === undefined ? '' : ` ↻ ${clock(five.resetsAt)}`;
  return {
    pct,
    text: {
      eta: pct >= ETA_AT && tokens > 0 ? etaOf(trend, tokens, threshold) : '',
      flags: flags.length === 0 ? ' ' : ` (${flags.join(' · ')}) `,
      lead: five === undefined ? '' : ' · 5h ',
      model: printable(pretty(reading.model)),
      percent: ` ${pct}%`,
      trail: five === undefined ? '' : tier + reset,
      usd: usd !== undefined && usd >= CENT_HALF ? ` · $${usd.toFixed(2)}` : '',
      used: five === undefined ? '' : `${used}%`,
    },
    used,
  };
};

/**
The window file's `five_hour` as `[resets_at, used_percentage]`, unread or unparsable as absent
*/
const priorWindow = async ($: EngineInterface, path: string): Promise<unknown[]> => {
  const five = await $.fs
    .read(path)
    .then((text) => field(JSON.parse(text), 'five_hour'))
    .catch(() => ({}));
  return [field(five, 'resets_at'), field(five, 'used_percentage')];
};

/**
The tokens auto-compact fires at, the window when it is off. `SessionContextUsage` carries `tokens`,
`window` and `percent` (against the window) only; `autoCompactThreshold` rides the /context
breakdown, whose `summary` form is counted locally and sends no request. The Rust derived it from
the env, settings files, ~/.claude.json and per-model tables; none of that is ported.
*/
const thresholdOf = async ($: EngineInterface, window: number): Promise<number> => {
  const usage = await $.session.usage({ breakdown: 'summary' });
  return usage.context.breakdown?.autoCompactThreshold ?? window;
};

const windowPath = async ($: EngineInterface): Promise<string | undefined> => {
  const home = present(await $.env.get('HOME'));
  const state =
    present(await $.env.get('XDG_STATE_HOME')) ??
    (home === undefined ? undefined : `${home}/.local/state`);
  const file = present(await $.env.get('CLAUDE_WINDOW_FILE'));
  return file ?? (state === undefined ? undefined : `${state}/claude/window.json`);
};

/**
Replace `path` with the window through a sibling temp file `mv`'d into place, since `$.fs.write`
is not atomic
*/
const writeWindow = async (
  $: EngineInterface,
  path: string,
  window: { at: number; resetsAt: number; used: number },
): Promise<void> => {
  const id = await $.session.id();
  const temporary = `${path}.${id}.tmp`;
  const at = Temporal.Instant.fromEpochMilliseconds(window.at).toString({ smallestUnit: 'second' });
  // the wire format, keys in persist_window's order
  const five = `"five_hour":{"resets_at":${window.resetsAt},"used_percentage":${window.used}}`;
  await $.fs.write(temporary, `{"at":"${at}",${five},"session_id":${JSON.stringify(id)}}\n`);
  const moved = await $.process.run(['/bin/mv', '-f', temporary, path]);
  if (moved.exitCode !== 0) {
    throw new Error(moved.stderr.trim());
  }
};

/**
Persist the five-hour window as `persist_window` does, for out-of-process readers (`sandman shift
clock`): only a window resetting within (0, 6h], never behind the file's live one (a later reset,
or more used of the same). Unlike the Rust there is no lock, so two sessions writing at once can
race their read-to-rename.
*/
/**
Whether the file's live window is ahead of `five`: a later reset, or more used of the same
*/
const isHeld = async (
  $: EngineInterface,
  path: string,
  { now, ...five }: { now: number; resetsAt: number; used: number },
): Promise<boolean> => {
  const [at, was] = await priorWindow($, path);
  const isAhead =
    typeof at === 'number' &&
    typeof was === 'number' &&
    Number.isSafeInteger(at) &&
    isLive(at, now);
  return isAhead && (at > five.resetsAt || (at === five.resetsAt && was > five.used));
};

const persist = async (
  $: EngineInterface,
  now: number,
  five: { resetsAt: number; used: number },
): Promise<void> => {
  if (!isLive(five.resetsAt, now)) {
    return;
  }
  if (five.used < 0 || five.used > PERCENT) {
    $.ui.log(`gauge: window: used_percentage ${five.used} is outside 0–100`);
    return;
  }
  const path = await windowPath($);
  if (path === undefined || (await isHeld($, path, { now, ...five }))) {
    return;
  }
  await writeWindow($, path, { at: now, ...five }).catch((error: unknown) => {
    $.ui.log(`gauge: window: ${path}: ${String(error)}`);
  });
};

/**
Keep a token sample at most every 15 s, the newest 40 (≈ 10 minutes); a token drop (/compact,
/clear) or a backwards clock clears them
*/
const sample = async ($: EngineInterface, tokens: number, now: number): Promise<void> => {
  const was = await read($, samples);
  const last = was.at(-1);
  const kept = last !== undefined && (tokens < last.tokens || last.at > now) ? [] : was;
  const newest = kept.at(-1);
  if (tokens > 0 && (newest === undefined || now - newest.at >= POLL_EVERY)) {
    await update($, samples, () => [...kept.slice(1 - SAMPLES_KEPT), { at: now, tokens }]);
  }
};

type Usage = Pick<SessionUsage, 'context' | 'cost' | 'rateLimits'>;

/**
One usage reading as the gauge keeps it, the threshold carried over while the window holds
*/
const readingOf = async ($: EngineInterface, usage: Usage, prior: Gauge): Promise<Gauge> => {
  const { tokens, window } = usage.context;
  const five = usage.rateLimits.find(({ kind }) => kind === 'five_hour');
  const resetsAt =
    five?.resetsAt === undefined
      ? undefined
      : Math.floor(Temporal.Instant.from(five.resetsAt).epochMilliseconds / MS);
  return {
    five: five && { resetsAt, used: five.percentUsed },
    model: await $.session.model(),
    threshold: prior.window === window ? prior.threshold : await thresholdOf($, window),
    tokens,
    usd: usage.cost?.usd,
    window,
  };
};

/**
Write one usage reading: its samples, the gauge when it moved, then the five-hour window
*/
const take = async ($: EngineInterface, usage: Usage): Promise<void> => {
  const prior = await read($, gauge);
  const next = await readingOf($, usage, prior);
  const now = await $.clock.now();
  await sample($, next.tokens ?? 0, now);
  if (JSON.stringify(next) === JSON.stringify(prior)) {
    return;
  }
  await update($, gauge, () => next);
  const resetsAt = next.five?.resetsAt;
  await (resetsAt === undefined || next.five === undefined
    ? undefined
    : persist($, now, { resetsAt, used: next.five.used }));
};

const poll = async ($: EngineInterface): Promise<void> => {
  const usage = await $.session.usage();
  await take($, usage);
};

/**
The gauge row, `<model> (<flags>) <bar> <pct>% ≈<eta> · $<cost> · 5h <used>%† ↻ <reset>`, its bar
taking what the rest leaves of the window (a 20-cell bar until it is measured), the engine's hint
beneath. `fast` is never a flag: no session-level fast mode reaches a mod.
*/
type Hint = Parameters<MatchedHook<'ui.render', { component: 'PromptHint' }>>[1];

/**
The event with the engine's permission-mode label taken off the head of its hint, and whether it was
*/
const unlabelled = (e: Hint): { event: Hint; isAuto: boolean } => {
  const line = e.props.hint.replace(MODE, '');
  const isAuto = line !== e.props.hint;
  return { event: isAuto ? { ...e, props: { ...e.props, hint: line } } : e, isAuto };
};

/**
`pct` of `width` cells in ⅛-cell steps
*/
const barOf = (pct: number, width: number): string => {
  const eighths = Math.round((pct / PERCENT) * Math.max(0, width) * CELL);
  return '█'.repeat(Math.floor(eighths / CELL)) + (EIGHTHS[eighths % CELL] ?? '');
};

const hint: MatchedHook<'ui.render', { component: 'PromptHint' }> = async ($, e, next) => {
  const reading = await read($, gauge);
  const { event, isAuto } = unlabelled(e);
  if (reading.window === 0) {
    return next(event);
  }
  const flags = flagsOf(await read($, effort), isAuto);
  const { pct, text, used } = segments(reading, flags, await read($, samples));
  const width =
    e.viewport === undefined
      ? BAR
      : e.viewport.columns - MARGIN - Object.values(text).join('').length;
  const filled = barOf(pct, width);
  const { Box, Text } = $.ui.resolve(e);
  const beneath = await next(event);
  return (
    <Box flexDirection="column">
      <Box>
        <Text weight="bold">{text.model}</Text>
        <Text dimColor>{text.flags}</Text>
        <Text color={tone(pct)}>{filled}</Text>
        <Text color="#444444">{'░'.repeat(Math.max(0, width - filled.length))}</Text>
        <Text color={tone(pct)}>{text.percent}</Text>
        <Text dimColor>{`${text.eta}${text.usd}${text.lead}`}</Text>
        <Text color={tone(used)}>{text.used}</Text>
        <Text dimColor>{text.trail}</Text>
      </Box>
      {beneath}
    </Box>
  );
};

const measure: Hook<'session.measure'> = async ($, e, next) => {
  await take($, e);
  return next(e);
};

const logged = ($: EngineInterface, work: Promise<void>): void => {
  work.catch((error: unknown) => {
    $.ui.log(`gauge: ${String(error)}`);
  });
};

/**
One reading at the start, so the row is up before the first turn; then, in an interactive session,
poll `$.session.usage()` (free without `breakdown`) every 15 s, so mid-turn growth shows
*/
const start: Hook<'session.start'> = async ($, e, next) => {
  logged($, poll($));
  if (e.isInteractive) {
    $.clock.every(POLL_EVERY, () => {
      logged($, poll($));
    });
  }
  return await next(e);
};

/**
The main loop's effort, kept for the flags: a mod sees it per request only
*/
const step: StreamHook<'turn.step'> = async function* step($, e, next) {
  const level = e.effort === undefined ? '' : String(e.effort);
  if (e.agentId === undefined && level !== (await read($, effort))) {
    await update($, effort, () => level);
  }
  return yield* next(e);
};

export { field, hint, measure, start, step };
