declare module 'claude-code' {
  interface PluginState {
    subether: {
      /** the gauge's effort flag: the main loop's last `turn.step` effort, "" on a model without one */
      effort: string;
      /** the gauge's last usage reading, `window` 0 until the first */
      gauge: Gauge;
      /** planned · chunk 8: the band's `last:`, today's newest trail event; no atom() yet */
      last: TrailEvent | null;
      /** whether a composer prompt was seen yet, so a `--bg` session's opening prompt (its launcher's brief) is told apart */
      opened: boolean;
      /** the session's recalls, oldest first: the seed its first prompt ran, then each pull the agent ran */
      recalls: Recall[];
      /** the gauge's token trend for its ≈ETA, oldest first */
      samples: Sample[];
      /** planned · chunk 8: the sandman shift the band shows, from `~/.sandman/shifts/current.json`; no atom() yet */
      shift: Shift | null;
      /** the pane's rows pressed away from their default (the newest recall open, the rest shut), by key */
      toggled: string[];
      /** the census feed's running workflow agents, by id: no `agent.report` ends them, their own `turn.complete` does */
      workflows: string[];
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

/** one recall as the pane draws it: the seed's stdout as attached, or a pull's result as the model read it */
export interface Recall {
  /** when it answered, in `$.clock.now()` milliseconds */
  at: number;
  /** why the seed attached nothing (`Error: exited 2: …`, a timeout); absent when it ran */
  error?: string;
  /** the session it ran for: a first prompt under another id seeds again */
  session: string;
  /** the seed's stderr: its stats line, and a failed stage's cause */
  stderr?: string;
  /** what was attached (after the cap) or read */
  text: string;
  /** who asked: the mod at the first prompt, or the agent */
  who: 'agent' | 'seed';
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
