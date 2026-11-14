export const meta = {
  name: 'execute-plan',
  description:
    'Carry out a written plan stage by stage, gating each, stopping on red, then review the whole diff against the plan',
  whenToUse:
    'A plan file exists (default: the newest in ~/.claude/plans/) and should be built: "/execute-plan", "execute the plan", "build it". Pass the plan path as the argument.',
  phases: [
    { title: 'Read', detail: 'resolve the plan, check drift' },
    { title: 'Execute', detail: 'implement, gate, one repair' },
    { title: 'Review', detail: 'whole diff against the plan' },
  ],
};

const path =
  (typeof args === 'string' ? args : args?.plan)?.trim() || 'the newest file in ~/.claude/plans/';
const O = (phase, schema, x) => ({ model: 'opus', phase, schema, ...x });
const str = { type: 'string' },
  strs = { type: 'array', items: str };
const obj = (properties, extra = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((k) => !extra.includes(k)),
});
const PLAIN = 'plain text under 2000 characters';
const GATE = obj({
  green: { type: 'boolean' },
  tail: { ...str, description: `the gate's output tail, ${PLAIN}` },
});
const IMPL = obj(
  {
    clarify: {
      ...str,
      description: 'set only when the brief is too underspecified to act on: the blocking question',
    },
    dir: { ...str, description: 'absolute path of the checkout you worked in' },
    filesTouched: strs,
    verification: { ...str, description: `the checks you ran and their output, ${PLAIN}` },
  },
  ['clarify'],
);

const plan = await agent(
  `Resolve and read ${path} in full (expand a relative path against the current directory). Return the absolute plan path, the repository it targets and whether that repository exists, and the gate it names (else \`mise run check\` where the repo defines it, else \`hk run pre-push\`, else its test command). Split it into its stages with stable ids, each stage's full instructions as its brief (the plan's own words, including whether it commits), the files it touches and the stage ids it depends on. Compare the plan with the repository as it stands and list every drift — files moved or gone, APIs changed, work already done.`,
  O(
    'Read',
    obj({
      drift: strs,
      gate: str,
      planPath: str,
      repo: str,
      repoExists: { type: 'boolean' },
      stages: {
        type: 'array',
        items: obj({ brief: str, dependsOn: strs, files: strs, id: str, title: str }),
      },
    }),
  ),
);
if (!plan?.repoExists)
  return { stopped: `the plan's repository ${plan?.repo} does not exist`, plan };
if (plan.drift.length) log(`drift: ${plan.drift.join('; ')}`);

const RULES = `Work only on this stage's files; uncommitted changes elsewhere belong to the plan's other stages or to the owner and stay as they are. Never run git checkout, restore, reset, clean, stash or switch. Commit or push only if the stage's brief says so. Done means you ran its verification and report the output; if the brief is too vague to act on, return clarify instead of guessing. If three edits to one file leave the result unchanged, stop and report what you learned.`;
const gate = (s, dir) =>
  agent(
    `In ${dir}, run the gate \`${plan.gate}\` and report whether it passes, with its output tail. Change nothing.`,
    O('Execute', GATE, { effort: 'low', label: `gate:${s.id}` }),
  );
const run = async (s) => {
  const impl = await agent(
    `Carry out stage ${s.id} — ${s.title} — of the plan at ${plan.planPath}, in ${plan.repo}.\nBrief:\n${s.brief}\nFiles: ${s.files.join(', ')}.\n${RULES}`,
    O('Execute', IMPL, { label: `implement:${s.id}` }),
  );
  if (!impl || impl.clarify)
    return { id: s.id, status: 'blocked', gate: impl?.clarify ?? 'implementer died' };
  let g = await gate(s, impl.dir);
  if (!g?.green) {
    await agent(
      `Stage ${s.id} of the plan at ${plan.planPath}, worked in ${impl.dir}, leaves the gate \`${plan.gate}\` red:\n${g?.tail}\nRepair it in ${impl.dir} without widening the stage.\nBrief:\n${s.brief}\n${RULES}`,
      O('Execute', IMPL, { label: `repair:${s.id}` }),
    );
    g = await gate(s, impl.dir);
  }
  return {
    gate: g?.tail ?? 'gate agent died',
    id: s.id,
    status: g?.green ? 'green' : 'red',
  };
};

const done = new Set(),
  stages = [];
let left = plan.stages,
  stoppedAt = null;
while (left.length && !stoppedAt) {
  const s = left.find((x) => x.dependsOn.every((d) => done.has(d)));
  if (!s) {
    stoppedAt = left[0].id;
    log(`unsatisfiable dependencies: ${left.map((x) => x.id).join(', ')}`);
    break;
  }
  const r = await run(s);
  stages.push(r);
  if (r.status === 'green') done.add(s.id);
  else stoppedAt = s.id;
  left = left.filter((x) => x !== s);
}

const review = await agent(
  `Review the work done in ${plan.repo} against the plan at ${plan.planPath}: read the plan, then the whole diff (uncommitted changes and any commits the stages made). Stages run and their outcomes: ${JSON.stringify(stages)}.${stoppedAt ? ` Execution stopped at ${stoppedAt}; later stages are unbuilt by design, not deviations.` : ''} Report every deviation from the plan — missing, extra or different work — each with its file and what the plan said. Change nothing.`,
  O('Review', obj({ deviations: strs, review: { ...str, description: PLAIN } })),
);
return {
  deviations: review?.deviations,
  drift: plan.drift,
  planPath: plan.planPath,
  review: review?.review,
  stages,
  stoppedAt,
};
