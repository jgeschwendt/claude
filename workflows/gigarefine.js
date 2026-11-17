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
  `Prepare a behaviour-preserving refinement of ${A.target ?? 'the artifacts this session created or modified'}. Resolve the target to its concrete file list. Record the invariant — ${A.invariant ? `the caller states it: ${A.invariant}` : 'the observable behaviour of its public boundary (for docs, the truth of their claims; for prompts, the contract they promise)'}. Find the gate: \`mise run check\` where the repo defines it, else \`hk run pre-push\`, else the repo's test command. If nothing in the suite exercises the target's public boundary, write characterization tests there first. Run the gate and report whether it is green with its output tail. Measure lines, and statements, functions and branches where a tool makes it cheap, and coverage if the repo reports it; null what you cannot measure. Return under measure the exact command that produced these metrics, runnable verbatim from the repository root; every later pass reruns it. This step only measures: apart from those characterization tests, change no file, and propose nothing.`,
  O(
    'Baseline',
    obj({
      files: strs,
      gate: { type: 'string' },
      gateTail: { type: 'string' },
      green: { type: 'boolean' },
      invariant: { type: 'string' },
      measure: { type: 'string' },
      metrics: METRICS,
      repo: { type: 'string' },
    }),
  ),
);
if (!base) return { stopped: 'the baseline agent died — nothing was measured', baseline: null };
if (!base.green)
  return {
    stopped: 'red baseline — refinement on red blends repair into refinement',
    baseline: base,
  };

const CONTEXT = `Target files in ${base.repo}: ${base.files.join(', ')}.\nInvariant, which nothing may change: ${base.invariant}.\nGate: ${base.gate}.`;
const PROPOSALS = obj({
  bugs: {
    type: 'array',
    items: obj({ claim: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' } }),
    description:
      'defects found en route, each claim with its reproducing evidence, at the file and first line where it lives — reported, never folded into a proposal',
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
  // every lens meets the same stale line: one report per file and line
  // per pass: applied edits move lines, so a key from an earlier pass names other code
  const seenBugs = new Set();
  for (const b of hunts.filter(Boolean).flatMap((h) => h.bugs)) {
    const at = `${b.file}:${b.line}`;
    if (!seenBugs.has(at) && seenBugs.add(at)) bugs.push(`${at}: ${b.claim}`);
  }
  const proposals = hunts
    .filter(Boolean)
    .flatMap((h) => h.proposals)
    .map((p, i) => ({ ...p, id: `p${pass}.${i}` }));
  const judged =
    proposals.length &&
    (await agent(
      `${CONTEXT}\nJudge each proposal on its evidence, which is a claim until you check it against the files. Accept only what preserves the invariant and makes the artifact better on its own lens; reject a blend that serves two lenses poorly, anything removing public surface (exported API, published doc sections, trigger phrases), and any behaviour change. Mark novel false where a proposal repeats one already seen, and revertsEarlier where it would undo a change applied in an earlier pass; two proposals of this pass that conflict are a reject, never a revert. Give every verdict a reason.\nProposals:\n${JSON.stringify(proposals)}${prior}`,
      O('Judge', VERDICTS),
    ));
  const { verdicts } = judged || { verdicts: [] };
  const by = Object.fromEntries(verdicts.map((v) => [v.id, v]));
  // a live judge that skips proposals is no convergence: every proposal needs its verdict
  const unjudged = proposals.filter((p) => !by[p.id]).length;
  if (unjudged) {
    stopped = `the judge ${judged ? 'skipped proposals' : 'died'}: ${unjudged} of pass ${pass}'s ${proposals.length} proposals went unjudged`;
    break;
  }
  const accepted = proposals.filter((p) => by[p.id]?.accept && !by[p.id].revertsEarlier);
  const applied =
    accepted.length &&
    (await agent(
      `${CONTEXT}\nApply these accepted changes one at a time, in order. After each, run the gate; a change that turns it red, or drops coverage below ${base.metrics.coverage ?? 'its baseline'}, you undo by re-editing the files back — never by git checkout, restore, stash or reset — and mark reverted. Then measure the metrics by running exactly the baseline's command, never another tool or scope — ${base.measure} — so before and after compare (baseline: ${JSON.stringify(base.metrics)}).\n${JSON.stringify(accepted)}`,
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
      disposition:
        results.find((r) => r.id === p.id)?.status ??
        (accepted.includes(p)
          ? 'accepted, the applier reported nothing: state unknown'
          : `rejected: ${by[p.id]?.reason}`),
    })),
  );
  const onlyAdds =
    count('applied') > 0 &&
    results.every(
      (r) => r.status !== 'applied' || accepted.find((p) => p.id === r.id)?.kind === 'add',
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
  // pass 1 has no earlier change to undo: a flag there is a same-pass conflict, not churn
  if (pass > 1 && verdicts.some((v) => v.revertsEarlier)) {
    stopped = 'churn — a pass proposed undoing an earlier change';
    break;
  }
  if (onlyAdds) {
    stopped = 'failed pass — it only added';
    break;
  }
}
if (base.metrics.coverage != null && !(after.coverage >= base.metrics.coverage))
  log(`coverage fell or went unmeasured: ${base.metrics.coverage} → ${after.coverage}`);
// the outcome leads: a caller is shown only the head of a long result
return { stopped, ledger, before: base.metrics, after, bugs, target: base.files };
