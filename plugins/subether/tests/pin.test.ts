import type { AgentSpawnInput, On } from 'claude-code';
import { expect, test } from 'claude-code/testing';

/**
A typed fixture from JSON, the event's engine-set fields left out
*/
const fixture: <T>(json: string) => T = JSON.parse;
/**
a general-purpose spawn, `fields` (`,"key":value…`) overriding
*/
const spawn = (fields: string): AgentSpawnInput =>
  fixture(`{"description":"d","prompt":"p","subagentType":"general-purpose"${fields}}`);

const PINNED = ['pinned d to opus'];

/**
The engine beneath: core inheriting a spawn with no model, and the log
*/
const engine = (on: On): string[] => {
  const logs: string[] = [];
  on('agent.spawn', ($, e) => ({ model: e.model ?? 'inherited' }));
  on('ui.log', ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  return logs;
};

/**
0.2.12's rows (a spawn with no model → opus, `haiku` kept, a fork inherited) under the native fields, the parent's
model now deciding
*/
for (const [name, json, model, logs] of [
  ['no model under Fable is pinned to opus', ',"parentModel":"claude-fable-5"', 'opus', PINNED],
  [
    'no model under Mythos, any case, is pinned',
    ',"parentModel":"Claude-Mythos-1"',
    'opus',
    PINNED,
  ],
  ['no model under Opus is left alone', ',"parentModel":"claude-opus-5-5"', 'inherited', []],
  ['a model given is kept', ',"model":"haiku","parentModel":"claude-fable-5"', 'haiku', []],
  ['a fork inherits', ',"parentModel":"claude-fable-5","subagentType":"fork"', 'inherited', []],
  ['a pin that fails passes the spawn on', '', 'inherited', []],
] as const) {
  test(name, async ($, on) => {
    const seen = engine(on);
    expect(await $.agent.spawn(spawn(json))).toEqual({ model });
    expect(seen).toEqual(logs);
  });
}
