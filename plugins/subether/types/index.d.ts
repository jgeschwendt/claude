declare module 'claude-code' {
  interface PluginState {
    subether: {
      /** the gauge's effort flag: the main loop's last `turn.step` effort, "" on a model without one */
      effort: string;
      /** the injected pane's expanded rows, by their `Injected.at`; every row collapsed to its header until pressed */
      expanded: number[];
      /** the gauge's last usage reading, `window` 0 until the first */
      gauge: Gauge;
      /** the context blocks the first prompt attached, oldest first; empty until one is */
      injected: Injected[];
      last: TrailEvent | null;
      opened: boolean;
      prompts: string[][];
      /** the gauge's token trend for its ≈ETA, oldest first */
      samples: Sample[];
      seen: Record<string, string>;
      shift: Shift | null;
    };
  }
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
