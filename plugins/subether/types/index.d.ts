declare module 'claude-code' {
  interface PluginState {
    subether: {
      /** the gauge's effort flag: the main loop's last `turn.step` effort, "" on a model without one */
      effort: string;
      /** the pane's expanded rows, by their header's key (`injected:<at>`, `judged:<at>`); every row collapsed until pressed */
      expanded: string[];
      /** each System One judge's availability, learned from the session-start probe and each call; both up until then */
      gate: Gate;
      /** the gauge's last usage reading, `window` 0 until the first */
      gauge: Gauge;
      /** the context blocks the first prompt attached, oldest first; empty until one is */
      injected: Injected[];
      /** the newest 20 judged prompts, oldest first */
      judged: Judged[];
      last: TrailEvent | null;
      /** whether a composer prompt was seen yet, so a `--bg` session's opening prompt (dispatch's brief) is told apart */
      opened: boolean;
      /** the heads (200 chars) of the last 3 judged prompts, oldest first: the repeat question's earlier prompts */
      prompts: string[];
      /** the gauge's token trend for its ≈ETA, oldest first */
      samples: Sample[];
      seen: Record<string, string>;
      shift: Shift | null;
    };
  }
}

/** one judge's availability */
export interface Availability {
  /** the `$.clock.now()` ms it is down until (`Number.MAX_SAFE_INTEGER` for the session); absent when up */
  until?: number;
  /** why it is down (`rate limited`, `busy`, `key refused (401)`); "" when up */
  why: string;
}

/** the System One judges, tried TypeSafe first */
export interface Gate {
  kev: Availability;
  typesafe: Availability;
}

/** one usage reading as the gauge row draws it */
export interface Gauge {
  /** the five-hour window: `resetsAt` in unix seconds, `used` its percentUsed */
  five?: { resetsAt?: number; used: number };
  /** `$.session.model()`, as /model shows it */
  model: string;
  /** the tokens auto-compact fires at; the window when auto-compact is off */
  threshold: number;
  tokens?: number;
  usd?: number;
  /** the model's context window `threshold` was resolved for */
  window: number;
}

/** one context block subether attached to a prompt, as the pane draws it */
export interface Injected {
  /** when it was attached, in `$.clock.now()` milliseconds */
  at: number;
  /** `text`'s length */
  chars: number;
  /** whether the cap cut it */
  cut: boolean;
  /** why the recall attached nothing (`Error: exited 2: …`, `Error: printed nothing`); absent when it attached */
  error?: string;
  source: 'sandman recall';
  /** the text attached, after the cap */
  text: string;
}

/** one judged prompt, as the pane draws it */
export interface Judged {
  /** when it was judged, in `$.clock.now()` milliseconds */
  at: number;
  /** the prompt's first 200 characters */
  head: string;
  /** who answered; absent when no judge did */
  judge?: keyof Gate;
  /** each marker's yes-probability; empty when no judge answered */
  markers: Record<string, number>;
  /** the billable input tokens the judge reported; absent when it reported none */
  tokens?: number;
}

/** one `{at, tokens}` observation, `at` in `$.clock.now()` milliseconds */
export interface Sample {
  at: number;
  tokens: number;
}

/** the sandman shift the band shows */
export interface Shift {
  handoff_by?: string;
  repo?: string;
  shift?: string;
  theme?: string;
}

/** one trail event, the band's `last:` */
export interface TrailEvent {
  kind?: string;
  rationale?: string;
}
