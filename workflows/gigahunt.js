export const meta = {
  name: 'gigahunt',
  description:
    'Read-only hunt for real defects in a codebase with no symptom given; each finding is reproduced or survives adversarial refutation before it is reported',
  whenToUse:
    'Audit an existing codebase for correctness, security or robustness defects with no observed failure: "audit this repo", "find bugs in X", "how safe is this before I expose it". args: a scope path and an optional focus word ("apps/web security"), or {scope, focus}. An observed failure is /gigadebug instead.',
  phases: [
    { title: 'Scout', detail: 'map the scope into reviewable units and name its commands' },
    { title: 'Hunt', detail: 'one finder per unit × lens' },
    { title: 'Verify', detail: 'reproduce, then refute, each distinct finding' },
  ],
};

const a =
  typeof args === 'string'
    ? (([scope, ...focus]) => ({ focus: focus.join(' '), scope }))(args.trim().split(/\s+/))
    : (args ?? {});
const arr = (items) => ({ items, type: 'array' });
const obj = (properties) => ({ properties, required: Object.keys(properties), type: 'object' });
const run = (phase, label, prompt, schema) =>
  agent(prompt, { label, model: 'opus', phase, schema });
const scope = a.scope || 'the git repository at the current working directory';
const str = { type: 'string' };
const LENSES = [
  'correctness: wrong results, unhandled errors, edge cases, off-by-one, null paths, silently swallowed failures',
  'robustness and concurrency: races, double-fire, shared state, crash mid-step and restart, stale state, leaks, unbounded growth, missing timeouts',
  'security: injection, authentication and authorization gaps, secrets in the tree, path traversal, unsafe deserialization, SSRF, crypto misuse',
];
const READ_ONLY = `Do not edit anything under ${scope}; probes, copies and test files go only in a fresh directory from mktemp -d.`;
const SEVERITY = ['critical', 'high', 'medium', 'low'];
const hit = LENSES.filter((l) => l.includes((a.focus ?? '').toLowerCase()));
const lenses = hit.length ? hit : [a.focus];
if (lenses.length < LENSES.length) log(`not covered: lenses outside focus "${a.focus}"`);

phase('Scout');
const map = await run(
  'Scout',
  'scout',
  `Map ${scope} for a defect hunt. Split it into reviewable units, each a cohesive group of source files one reviewer can hold at once, together covering every tracked source file. Name the commands the repo's own config defines to build it and run its tests (empty when there is none). List under uncovered anything you left out (generated, vendored, binary) with the reason. ${READ_ONLY}`,
  obj({
    build: str,
    test: str,
    uncovered: arr(str),
    units: arr(obj({ name: str, paths: arr(str) })),
  }),
);
if (!map) throw new Error('scout returned nothing');
map.uncovered.forEach((u) => log(`not covered: ${u}`));

const seen = new Set();
const key = (f) => `${f.file}:${f.line}`;
const verify = async (f) => {
  const claim = `${key(f)} (${f.severity}): ${f.claim}\nScenario: ${f.scenario}`;
  const p = await run(
    'Verify',
    `repro ${key(f)}`,
    `Reproduce this suspected defect in ${scope} deterministically.\n${claim}\nWrite the smallest probe or test that triggers it, run it, and report the exact command and its output. The repo's tests run with: ${map.test || 'no command found'}. Set reproduced only when a run shows the defect, never because the code reads that way. ${READ_ONLY}`,
    obj({ command: str, evidence: str, reproduced: { type: 'boolean' } }),
  );
  const votes = (
    await parallel(
      Array.from(
        { length: SEVERITY.indexOf(f.severity) < 2 ? 3 : 1 },
        (_, i) => () =>
          run(
            'Verify',
            `refute ${key(f)} #${i + 1}`,
            `Disprove this suspected defect in ${scope}.\n${claim}\nReproduction attempt: ${p?.reproduced ? 'reproduced' : 'not reproduced'}: ${p?.evidence ?? 'none'}\nLook for the guard, caller contract or invariant that makes it unreachable, or the flaw in the probe. Set refuted when you find one; otherwise give the reason it stands. ${READ_ONLY}`,
            obj({ reason: str, refuted: { type: 'boolean' } }),
          ),
      ),
    )
  ).filter(Boolean);
  if (!votes.length || votes.filter((v) => v.refuted).length * 2 >= votes.length) return null;
  const ok = p?.reproduced;
  return {
    claim: f.claim,
    evidence: ok ? p.evidence : votes.map((v) => v.reason).join(' · '),
    file: f.file,
    line: f.line,
    repro: ok ? p.command : '',
    severity: f.severity,
    verdict: ok ? 'CONFIRMED' : 'PLAUSIBLE',
  };
};

const jobs = map.units.flatMap((u) => lenses.map((lens) => ({ lens, u })));
const results = await pipeline(
  jobs,
  ({ lens, u }) =>
    run(
      'Hunt',
      `${u.name} · ${lens.split(':')[0]}`,
      `Hunt unit "${u.name}" of ${scope} (${u.paths.join(', ')}) for real defects under this lens: ${lens}. Report only defects with a concrete triggering scenario, at the file and line where the defect lives; an empty list is a valid result. ${READ_ONLY}`,
      obj({
        findings: arr(
          obj({
            claim: str,
            file: str,
            line: { type: 'integer' },
            scenario: str,
            severity: { enum: SEVERITY, type: 'string' },
          }),
        ),
      }),
    ),
  (r) =>
    parallel(
      r.findings.filter((f) => !seen.has(key(f)) && seen.add(key(f))).map((f) => () => verify(f)),
    ),
);
results.forEach(
  (r, i) =>
    r || log(`not covered: ${jobs[i].u.name} × ${jobs[i].lens.split(':')[0]} (finder failed)`),
);
return results
  .flat()
  .filter(Boolean)
  .sort(
    (x, y) =>
      SEVERITY.indexOf(x.severity) - SEVERITY.indexOf(y.severity) ||
      x.verdict.localeCompare(y.verdict),
  );
