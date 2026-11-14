export const meta = {
  name: 'gigadebug',
  description:
    'Root-cause one observed failure: reproduce it, eliminate competing falsifiable hypotheses on differential evidence, and fix only a sole surviving cause behind a regression test',
  whenToUse:
    'Something is observably broken and the cause is unknown: a failing test, an error, wrong output, "worked yesterday". args: the symptom (error text, failing command or test name), or {symptom}. No symptom is /gigahunt instead.',
  phases: [
    { title: 'Reproduce', detail: 'a deterministic repro, the suite baseline and the facts' },
    {
      title: 'Investigate',
      detail: 'hypotheses from five angles, each tested for its kill observation',
    },
    { title: 'Fix', detail: 'regression test first, the cause fixed, then an independent re-run' },
  ],
};

const symptom = typeof args === 'string' ? args.trim() : args?.symptom;
const arr = (items) => ({ items, type: 'array' });
const bool = { type: 'boolean' };
const obj = (properties) => ({ properties, required: Object.keys(properties), type: 'object' });
const run = (phase, label, prompt, schema) =>
  agent(prompt, { label, model: 'opus', phase, schema });
const str = { type: 'string' };
const ANGLES = [
  'data or state: inputs, persisted state, caches, fixtures',
  'dependency: a library, service or platform behaving other than this code assumes',
  'environment or config: tool and runtime versions, env vars, paths, platform, settings',
  'recent change: what changed in code, lockfile or config since it last worked; with a known-good revision, git bisect run the repro in a throwaway git worktree',
  'timing or concurrency: ordering, races, timeouts, shared resources',
];
const READ_ONLY =
  'Do not edit the repo or its checkout: probes go in a fresh directory from mktemp -d, history is explored in a throwaway git worktree, and no fix is tried to see what happens.';
const none = (evidence, eliminated = []) => ({
  cause: null,
  eliminated,
  evidence,
  fix: null,
  regressionTest: null,
  verified: false,
});
if (!symptom) return none('no symptom given');

phase('Reproduce');
const rep = await run(
  'Reproduce',
  'reproduce',
  `Reproduce this failure: ${symptom}\nFind the smallest deterministic command that shows it. An intermittent failure counts as reproduced when repeated runs give a measured failure rate; put the rate in observed. Record the test suite's command and its status before anything changes, pre-existing failures included. Gather the facts a diagnosis needs: the full error and stack, the failing path's code, recent history of the implicated files, environment details. If it will not reproduce, say in observed what you tried and what logging or state capture would make it reproducible. ${READ_ONLY}`,
  obj({
    baseline: str,
    command: str,
    expected: str,
    facts: arr(str),
    observed: str,
    reproduced: bool,
    suite: str,
  }),
);
if (!rep?.reproduced)
  return none(`not reproduced: ${rep?.observed ?? 'reproduction agent failed'}`);
const CASE = `Failure: ${symptom}\nRepro: ${rep.command}\nExpected: ${rep.expected}\nObserved: ${rep.observed}\nSuite baseline (${rep.suite}): ${rep.baseline}\nFacts:\n${rep.facts.join('\n')}`;

const tested = (
  await pipeline(
    ANGLES,
    (angle) =>
      run(
        'Investigate',
        angle.split(':')[0],
        `${CASE}\n\nPropose root-cause hypotheses for this failure from one angle: ${angle}. Each must name the observation that would kill it, one its rivals would not predict. Return none rather than a hypothesis that cannot be killed. ${READ_ONLY}`,
        obj({ hypotheses: arr(obj({ claim: str, kill: str })) }),
      ),
    (r, angle) =>
      parallel(
        r.hypotheses.map((h, i) => async () => ({
          ...h,
          ...(await run(
            'Investigate',
            `${angle.split(':')[0]} #${i + 1}`,
            `${CASE}\n\nTest one hypothesis: ${h.claim}\nIt dies if: ${h.kill}\nInstrument, log and run until the discriminating observation is in hand. Verdict supports only when you observed what this hypothesis predicts and its rivals do not; refutes when the kill observation occurs; inconclusive otherwise. Evidence is the commands and output that decided it. ${READ_ONLY}`,
            obj({
              evidence: str,
              verdict: { enum: ['inconclusive', 'refutes', 'supports'], type: 'string' },
            }),
          )),
        })),
      ),
  )
)
  .flat()
  .filter((h) => h?.verdict);
const line = (h) => `${h.claim}: ${h.evidence}`;
const eliminated = tested.filter((h) => h.verdict === 'refutes').map(line);
const survivors = tested.filter((h) => h.verdict === 'supports');
if (survivors.length !== 1)
  return none(
    `${survivors.length} causes survived; open: ${
      tested
        .filter((h) => h.verdict !== 'refutes')
        .map(line)
        .join(' · ') || 'none'
    }`,
    eliminated,
  );
const [cause] = survivors;

phase('Fix');
const fix = await run(
  'Fix',
  'fix',
  `${CASE}\n\nRoot cause, established by differential evidence: ${line(cause)}\nFirst write a regression test named after the cause that reproduces the failure, and run it to show it failing. Then fix the cause at its own site, minimally, and show the regression test and the full suite (${rep.suite}) passing, with no existing test weakened. If the cause lies in a dependency or the platform rather than this repo, change nothing and set applied false: a workaround is the owner's call.`,
  obj({ applied: bool, failingBefore: str, fix: str, passingAfter: str, regressionTest: str }),
);
const check =
  fix?.applied &&
  (await run(
    'Fix',
    'verify',
    `A fix for this failure was just applied in the working tree.\n${CASE}\nClaimed fix: ${fix.fix}\nRegression test: ${fix.regressionTest}\nIndependently re-run the regression test, the original repro and the full suite, and read the uncommitted diff: it should touch only the cause site and the new test. Report what each run showed.`,
    obj({ evidence: str, passed: bool }),
  ));
return {
  cause: cause.claim,
  eliminated,
  evidence: [
    cause.evidence,
    fix && `before: ${fix.failingBefore}`,
    fix && `after: ${fix.passingAfter}`,
    check?.evidence,
  ]
    .filter(Boolean)
    .join('\n'),
  fix: fix?.applied ? fix.fix : null,
  regressionTest: fix?.applied ? fix.regressionTest : null,
  verified: !!check?.passed,
};
