export const meta = {
  name: 'gigarefine',
  description:
    'Drive a named artifact to its best form over hunt → judge → apply passes, behaviour preserved, until proposals run dry',
  whenToUse:
    'An artifact (module, package, doc, prompt) should be made excellent within its existing structure: "gigarefine X", "refactor this properly", "polish until diminishing returns". Structural change (components added, split, merged) is /gigaredesign.',
  phases: [
    { title: 'Baseline', detail: 'invariant, gate, metrics' },
    { title: 'Hunt', detail: 'one hunter per lens' },
    { title: 'Judge', detail: 'accept or reject each proposal' },
    { title: 'Apply', detail: 'one applier, gate after each change' },
  ],
};

const A = typeof args === 'string' ? { target: args } : (args ?? {});
const LENSES = [
  'deletion and redundancy: code, branches, files and prose that can go',
  'efficiency: needless work, allocation, IO or round trips',
  'idiom and consistency: the language’s and the repo’s own conventions',
  'naming and clarity: names, signatures and flow a reader understands at first sight',
  'structure: altitude, cohesion and placement within the existing component boundaries',
  'test coverage the refactor makes cheap: tests are source code, refined by the same standard — fewer, sharper, end to end',
];
const METRICS = {
  type: 'object',
  properties: Object.fromEntries(
    ['branches', 'coverage', 'functions', 'lines', 'statements'].map((k) => [
      k,
      { type: ['number', 'null'] },
    ]),
  ),
};
const O = (phase, schema, x) => ({ model: 'opus', phase, schema, ...x });
const strs = { type: 'array', items: { type: 'string' } };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties) });

const base = await agent(
  `Prepare a behaviour-preserving refinement of ${A.target ?? 'the artifacts this session created or modified'}. Resolve the target to its concrete file list. Record the invariant — ${A.invariant ? `the caller states it: ${A.invariant}` : 'the observable behaviour of its public boundary (for docs, the truth of their claims; for prompts, the contract they promise)'}. Find the gate: \`mise run check\` where the repo defines it, else \`hk run pre-push\`, else the repo's test command. If nothing in the suite exercises the target's public boundary, write characterization tests there first. Run the gate and report whether it is green with its output tail. Measure lines, and statements, functions and branches where a tool makes it cheap, and coverage if the repo reports it; null what you cannot measure.`,
  O(
    'Baseline',
    obj({
      files: strs,
      gate: { type: 'string' },
      gateTail: { type: 'string' },
      green: { type: 'boolean' },
      invariant: { type: 'string' },
      metrics: METRICS,
      repo: { type: 'string' },
    }),
  ),
);
if (!base?.green)
  return {
    stopped: 'red baseline — refinement on red blends repair into refinement',
    baseline: base,
  };

const CONTEXT = `Target files in ${base.repo}: ${base.files.join(', ')}.\nInvariant, which nothing may change: ${base.invariant}.\nGate: ${base.gate}.`;
const PROPOSALS = obj({
  bugs: {
    ...strs,
    description:
      'defects found en route, each with its reproducing evidence — reported, never folded into a proposal',
  },
  proposals: {
    type: 'array',
    items: obj({
      change: { type: 'string' },
      evidence: { type: 'string' },
      file: { type: 'string' },
      kind: { enum: ['add', 'remove', 'rewrite'] },
      location: { type: 'string' },
    }),
  },
});
const VERDICTS = obj({
  verdicts: {
    type: 'array',
    items: obj({
      accept: { type: 'boolean' },
      id: { type: 'string' },
      novel: { type: 'boolean' },
      reason: { type: 'string' },
      revertsEarlier: { type: 'boolean' },
    }),
  },
});
const APPLIED = obj({
  metrics: METRICS,
  results: {
    type: 'array',
    items: obj({
      id: { type: 'string' },
      note: { type: 'string' },
      status: { enum: ['applied', 'reverted', 'skipped'] },
    }),
  },
});

const history = [],
  ledger = [],
  bugs = [];
let after = base.metrics,
  stopped = 'max passes';
for (let pass = 1; pass <= (A.passes ?? 3); pass++) {
  const prior = history.length
    ? `\nAlready proposed in earlier passes, with dispositions — do not re-propose these:\n${history.map((h) => `- [${h.disposition}] ${h.file} ${h.location}: ${h.change}`).join('\n')}`
    : '';
  const hunt = (lens) =>
    agent(
      `${CONTEXT}\nHunt the target for improvements through one lens only — ${lens}. Other lenses are covered by sibling hunters. Each proposal names its file and location, the concrete change, and the evidence it is better and preserves the invariant. Propose nothing that changes behaviour, removes public surface, or restructures components; return an empty list if the lens finds nothing worth doing.${prior}`,
      O('Hunt', PROPOSALS, { label: `hunt:${lens.split(':')[0]}` }),
    );
  const hunts = await parallel(LENSES.map((l) => async () => (await hunt(l)) ?? hunt(l)));
  const missing = LENSES.filter((_, i) => !hunts[i]).map((l) => l.split(':')[0]);
  if (missing.length)
    log(`pass ${pass}: lenses failed twice and are absent — ${missing.join(', ')}`);
  bugs.push(...hunts.filter(Boolean).flatMap((h) => h.bugs));
  const proposals = hunts
    .filter(Boolean)
    .flatMap((h) => h.proposals)
    .map((p, i) => ({ ...p, id: `p${pass}.${i}` }));
  const judged =
    proposals.length &&
    (await agent(
      `${CONTEXT}\nJudge each proposal on its evidence, which is a claim until you check it against the files. Accept only what preserves the invariant and makes the artifact better on its own lens; reject a blend that serves two lenses poorly, anything removing public surface (exported API, published doc sections, trigger phrases), and any behaviour change. Mark novel false where a proposal repeats one already seen, and revertsEarlier where it would undo an earlier accepted change. Give every verdict a reason.\nProposals:\n${JSON.stringify(proposals)}${prior}`,
      O('Judge', VERDICTS),
    ));
  if (proposals.length && !judged) {
    stopped = `the judge died: pass ${pass}'s ${proposals.length} proposals went unjudged`;
    break;
  }
  const { verdicts } = judged || { verdicts: [] };
  const by = Object.fromEntries(verdicts.map((v) => [v.id, v]));
  const accepted = proposals.filter((p) => by[p.id]?.accept && !by[p.id].revertsEarlier);
  const applied =
    accepted.length &&
    (await agent(
      `${CONTEXT}\nApply these accepted changes one at a time, in order. After each, run the gate; a change that turns it red, or drops coverage below ${base.metrics.coverage ?? 'its baseline'}, you undo by re-editing the files back — never by git checkout, restore, stash or reset — and mark reverted. Then measure the same metrics as the baseline (${JSON.stringify(base.metrics)}).\n${JSON.stringify(accepted)}`,
      O('Apply', APPLIED, { label: `apply:pass${pass}` }),
    ));
  if (accepted.length && !applied) {
    stopped = `the applier died: pass ${pass}'s ${accepted.length} accepted changes may be partly applied`;
    break;
  }
  const { results, metrics } = applied || { results: [], metrics: after };
  after = metrics;
  const count = (s) => results.filter((r) => r.status === s).length;
  const novel = proposals.filter((p) => by[p.id]?.novel);
  history.push(
    ...proposals.map((p) => ({
      ...p,
      disposition: results.find((r) => r.id === p.id)?.status ?? `rejected: ${by[p.id]?.reason}`,
    })),
  );
  const onlyAdds =
    count('applied') > 0 &&
    results.every(
      (r) => r.status !== 'applied' || accepted.find((p) => p.id === r.id).kind === 'add',
    );
  ledger.push({
    pass,
    proposed: proposals.length,
    novel: novel.length,
    accepted: accepted.length,
    applied: count('applied'),
    reverted: count('reverted'),
    ...(missing.length && { missing }),
    ...(onlyAdds && { failed: 'only adds' }),
  });
  log(
    `pass ${pass}: ${novel.length} new of ${proposals.length} proposed, ${count('applied')} applied, ${count('reverted')} reverted`,
  );
  if (!novel.length && !missing.length) {
    stopped = 'converged — no new proposals';
    break;
  }
  if (verdicts.some((v) => v.revertsEarlier)) {
    stopped = 'churn — a pass proposed undoing an earlier change';
    break;
  }
  if (onlyAdds) {
    stopped = 'failed pass — it only added';
    break;
  }
}
if ((after.coverage ?? 0) < (base.metrics.coverage ?? 0))
  log(`coverage fell: ${base.metrics.coverage} → ${after.coverage}`);
return { after, before: base.metrics, bugs, ledger, stopped, target: base.files };
