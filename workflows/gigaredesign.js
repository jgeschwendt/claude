export const meta = {
  name: 'gigaredesign',
  description:
    'Map a codebase whole, commit to the one structure it should have, and write an always-green migration plan for /execute-plan',
  whenToUse:
    'The structure itself is the problem — components should be added, removed, merged or rearranged: "gigaredesign X", "rearchitect this", "this grew wrong". It plans; /execute-plan rebuilds on the plan it writes. Polish within the existing structure is /gigarefine.',
  phases: [
    { title: 'Map', detail: 'scout, then one reader per component' },
    { title: 'Design', detail: 'three designers from different stances' },
    { title: 'Judge', detail: 'one judge per criterion, scoring every design' },
    { title: 'Plan', detail: 'commit to one design, write the staged migration' },
  ],
};

const A = typeof args === 'string' ? { scope: args } : (args ?? {});
const O = (phase, schema, x) => ({ model: 'opus', phase, schema, ...x });
const str = { type: 'string' },
  strs = { type: 'array', items: str };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties) });
const INVARIANT =
  'External behaviour is the invariant: public API, CLI surface, wire and file formats, persisted schemas, observable behaviour.';

const scout = await agent(
  `Scout ${A.scope ?? 'the current repository'} for a redesign${A.goal ? ` driven by this concern: ${A.goal}` : ''}. Partition every tracked file in scope into components by responsibility, so each file lands in exactly one; list any file you cannot place under unassigned. Find the gate (\`mise run check\` where the repo defines it, else \`hk run pre-push\`, else its test command), run it, and enumerate the external contract with the test or probe covering each item, noting items nothing covers. Propose a short kebab-case slug for the plan if none is given${A.slug ? ` (given: ${A.slug})` : ''}.`,
  O(
    'Map',
    obj({
      components: { type: 'array', items: obj({ files: strs, name: str }) },
      contract: strs,
      gate: str,
      gateTail: str,
      green: { type: 'boolean' },
      repo: str,
      slug: str,
      unassigned: strs,
    }),
  ),
);
if (!scout?.green)
  return { stopped: 'red baseline — no stage can promise green on a red gate', scout };
if (scout.unassigned.length) log(`unassigned files: ${scout.unassigned.join(', ')}`);

const map = (
  await parallel(
    scout.components.map(
      (c) => () =>
        agent(
          `Read component ${c.name} of ${scout.repo} whole: ${c.files.join(', ')}. Describe what is, not what should be — report bugs you meet as smells, never fix them.`,
          O(
            'Map',
            obj({
              dependedOnBy: strs,
              dependsOn: strs,
              name: str,
              publicSurface: strs,
              responsibility: str,
              smells: strs,
              stateOwned: strs,
              tests: strs,
            }),
            { label: `read:${c.name}` },
          ),
        ),
    ),
  )
).filter(Boolean);
const MAP = `Repository ${scout.repo}${A.goal ? `, concern: ${A.goal}` : ''}.\n${INVARIANT}\nContract:\n${scout.contract.join('\n')}\nComponent map:\n${JSON.stringify(map)}`;

const DESIGN = obj({
  components: { type: 'array', items: obj({ name: str, responsibility: str }) },
  dispositions: {
    type: 'array',
    items: obj({
      fate: { enum: ['kept', 'moved', 'merged', 'split', 'deleted'] },
      into: str,
      old: str,
      reason: str,
    }),
  },
  restructure: {
    type: 'boolean',
    description: 'false when the current structure is already right and the pain is polish-level',
  },
  stance: str,
  summary: str,
  tradeoffs: str,
});
const STANCES = [
  'the smallest change that fixes the structure — and if the current structure is already right, say so with restructure false',
  'the ideal structure, ignoring migration cost',
  'organised around the data and its lifecycle: who creates, owns, transforms and retires each piece of state',
];
const designs = (
  await parallel(
    STANCES.map(
      (s, i) => () =>
        agent(
          `${MAP}\nPropose one whole design for this codebase from this stance: ${s}. Whole means every component and boundary named, and a disposition for every mapped component — kept, moved, merged, split, or deleted with its reason. Resolve each smell in the map or say why it stands.`,
          O('Design', DESIGN, { label: `design:${i + 1}` }),
        ),
    ),
  )
).filter(Boolean);

const CRITERIA = [
  'fit to the responsibilities the map actually shows, and how fully it resolves the map’s smells and the stated concern',
  'migration cost and seam quality: can it be reached in small stages that each keep the gate green',
  'coherence: one organising principle carried through, boundaries that will not need redrawing next quarter',
];
const scores = (
  await parallel(
    CRITERIA.map(
      (c, i) => () =>
        agent(
          `${MAP}\nScore every design below from 1 to 10 on one criterion only — ${c} — with the evidence from the map for each score.\n${JSON.stringify(designs.map((_, j) => designs[(i + j) % designs.length]))}`,
          O(
            'Judge',
            obj({
              scores: {
                type: 'array',
                items: obj({ evidence: str, score: { type: 'number' }, stance: str }),
              },
            }),
            { label: `judge:${i + 1}` },
          ),
        ),
    ),
  )
).filter(Boolean);

const chosen = await agent(
  `${MAP}\nDesigns:\n${JSON.stringify(designs)}\nScores by criterion:\n${JSON.stringify(scores)}\nCommit to one design whole. Where designs differ in kind, pick a winner and never average them; graft an idea from a runner-up only where it leaves the winner's shape unchanged. If the winner keeps the current structure, set restructure false. Say why each losing design lost, and the risks the winner carries.`,
  O(
    'Plan',
    obj({
      design: DESIGN,
      rejected: { type: 'array', items: obj({ stance: str, why: str }) },
      risks: strs,
    }),
  ),
);
if (!chosen) return { stopped: 'the synthesizer died', designs, scores };
if (!chosen.design.restructure)
  return {
    design: chosen.design,
    rejected: chosen.rejected,
    risks: chosen.risks,
    next: '/gigarefine — the structure holds',
  };

const planned = await agent(
  `${MAP}\nGate: ${scout.gate}.\nChosen design:\n${JSON.stringify(chosen.design)}\nWrite the migration from today's structure to this design as ordered stages to ~/.claude/plans/${A.slug ?? scout.slug}.md, the shape /execute-plan reads: the repo and gate at the top, then per stage an id, a title, the files it owns, the stage ids it depends on, a brief that stands alone for an implementer, its verification, its rollback, and whether it ends in a commit. Every stage leaves the gate green and the system shippable; dependencies precede dependents; stages without an ordering edge own disjoint files. Contract items nothing covers get boundary tests in the first stage — boundary only, since internal tests pin the structure being demolished. The last stage wires the design's rules as executable guards and proves each fails once against a deliberate violation. Write only the plan file; change nothing in the repo.`,
  O('Plan', obj({ planPath: str, stages: { type: 'number' } })),
);
return {
  design: chosen.design,
  planPath: planned?.planPath,
  rejected: chosen.rejected,
  risks: chosen.risks,
  unassigned: scout.unassigned,
};
