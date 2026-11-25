import type { AgentSpawnInput } from 'claude-code';
import { type Engine, expect, test } from 'claude-code/testing';

/**
A typed fixture from JSON, the event's engine-set fields left out
*/
const fixture: <T>(json: string) => T = JSON.parse;
/**
The prompt core saw for a general-purpose spawn, `fields` overriding
*/
const seen = async ($: Engine, fields: object): Promise<string | undefined> => {
  const { agentId } = await $.agent.spawn({
    ...fixture<AgentSpawnInput>(
      '{"description":"d","fork":false,"parentModel":"claude-opus-5-5","prompt":"p","subagentType":"general-purpose"}',
    ),
    ...fields,
  });
  return agentId;
};

test('a new agent gets the rules once; a fork, a resume and a failed brief pass as they came', async ($, on) => {
  on('agent.spawn', ($$, e) => ({ agentId: e.prompt, model: 'm' }));
  const briefed = await seen($, {});
  expect(briefed).toStartWith('p\n\nHouse rules:\n- Edit files with Edit/Write');
  expect(briefed).toEndWith('unless the brief names one.');
  expect(await seen($, { prompt: briefed })).toBe(briefed);
  expect(await seen($, { fork: true, subagentType: 'fork' })).toBe('p');
  expect(await seen($, { resume: { agentId: 'a1' } })).toBe('p');
  expect(await seen($, { prompt: undefined })).toBeUndefined();
});
