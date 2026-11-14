/**
The subagent pin, under the house rule (~/.claude/CLAUDE.md "Operation"): premium models plan and review, and an
unpinned spawn inherits the session model. A spawn with no `model`, not a fork, under a premium parent runs on opus;
any other spawn passes as it came. A fork's `model` is ignored, since it always inherits (claude-code.d.ts 2.1.318,
AgentSpawnInput `model`, lines 299–307)
*/
import type { Hook } from 'claude-code';

/**
the premium model families, matched anywhere in the parent's id, any case
*/
const PREMIUM = ['fable', 'mythos'] as const;

const isPremium = (model: string): boolean =>
  PREMIUM.some((name) => model.toLowerCase().includes(name));

/**
Pins a spawn with no model, not a fork, under a premium parent to opus, one dim log line naming it
*/
const pin: Hook<'agent.spawn'> = async ($, e, next) => {
  if (e.model !== undefined || e.subagentType === 'fork' || !isPremium(e.parentModel)) {
    return await next(e);
  }
  $.ui.log(`pinned ${e.description} to opus`);
  return await next({ ...e, model: 'opus' });
};

export { pin };
