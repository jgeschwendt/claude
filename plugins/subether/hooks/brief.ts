/**
The subagent brief: a new agent that is not a fork starts with the house rules its parent's memory carries and its own
brief does not, appended to its prompt. A fork inherits the parent's context (the matcher keeps it out), and a resume's
content cannot be rewritten (claude-code.d.ts 2.1.331, AgentSpawnInput `resume`), so both pass as they came
*/
import type { Hook } from 'claude-code';

/**
the rules a subagent broke most in the tool log (2026-11-24 and 2026-11-28 evals), each from ~/.claude/CLAUDE.md
*/
const RULES = `House rules:
- Edit files with Edit/Write, never a \`python3 - <<EOF\` or \`sed -i\` read-replace-write; Read a file before its first Edit.
- Name the target (\`git -C <repo>\`, \`mise x -C <repo>\`); never open a command with \`cd\`.
- Gate with \`mise run -C <repo> check\`, never its steps by hand.
- Stop a process with \`mise run stop <pid|:port>\`, never \`pkill -f\`.
- Never wait in the foreground (\`sleep\`, \`perl -e 'select(…)'\`); wait on a background command that exits on the condition.
- Search with \`rg\`, never \`grep\`.
- A repo's state is \`mise run git-where <repo>\`, never \`git status\` then \`git log\`.
- A PDF's text is \`mise run fetch-pdf <url|file> [-o <file>]\`, never \`curl\` + \`pdftotext\`.
- Return your report as your final message; write no report file unless the brief names one.`;

/**
Appends the rules to a new agent's prompt, once
*/
const brief: Hook<'agent.spawn'> = async ($, e, next) =>
  await next(
    e.resume !== undefined || e.prompt.includes(RULES)
      ? e
      : { ...e, prompt: `${e.prompt}\n\n${RULES}` },
  );

export { brief };
