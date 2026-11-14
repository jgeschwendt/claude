export const meta = {
  name: 'gigadecide',
  description:
    'Advise on a hard-to-reverse choice between options: independent advocates, blind verification of their claims and three independent verdicts, tallied in code; it changes nothing and decides nothing',
  whenToUse:
    'A consequential, hard-to-reverse choice between designs, libraries, migration paths or build vs buy, where reasoning in one context would only promise independence: the advocate, the checker and the judges must be separate agents. args: the decision as text, or {decision, options, criteria, context}; context is a repo path or files to read. An observed failure is /gigadebug instead.',
  phases: [
    {
      title: 'Frame',
      detail: 'the decision restated, premises checked, options widened, the crux named',
    },
    { title: 'Advocate', detail: 'one advocate per option, evidence gathered live' },
    {
      title: 'Attack',
      detail:
        'blind answers to the claims as open questions, a premortem, the kill observation tried',
    },
    { title: 'Judge', detail: 'three independent verdicts on the claim tables, tallied in code' },
  ],
};

const a = typeof args === 'string' ? { decision: args.trim() } : (args ?? {});
const arr = (items) => ({ items, type: 'array' });
const list = (x) => [x].flat().filter(Boolean).join('; ');
const name = (o) => o.split(':')[0].trim();
const obj = (properties) => ({ properties, required: Object.keys(properties), type: 'object' });
const out = (reason, rest) => ({
  crux: null,
  options: [],
  premisesUnchecked: [],
  probe: null,
  reason,
  split: false,
  verdict: null,
  votes: [],
  ...rest,
});
const run = (phase, label, prompt, schema) =>
  agent(prompt, { label, model: 'opus', phase, schema });
const str = { type: 'string' };
const JUDGES = 3;
const READ_ONLY =
  'Change nothing in the repo or its checkout: probes, prototypes and benchmarks go in a fresh directory from mktemp -d.';
const STATUS = { enum: ['contradicted', 'unverified', 'verified'], type: 'string' };
if (!a.decision) return out('no decision given');
const CASE = [
  `Decision: ${a.decision}`,
  a.options && `Options the caller has: ${list(a.options)}`,
  a.criteria && `What matters to the caller: ${list(a.criteria)}`,
  a.context && `Read: ${list(a.context)}`,
]
  .filter(Boolean)
  .join('\n');

phase('Frame');
const fr = await run(
  'Frame',
  'frame',
  `${CASE}\n\nFrame this decision before anyone argues for an option. Restate it in your own words, stripped of any causal or preferential vocabulary it arrived in: a question that names a favourite has half-answered itself. List every premise the request hands down, stated or not; check the cheap ones live, and mark one checked only when you observed it, with the observation as evidence. Widen the options past incumbent versus challenger: keep any the caller listed, and always include the boring option and doing nothing. Each option is a short distinct name, a colon, then one line. State the criteria, the caller's first, each with the observable that would distinguish the options on it. Name the crux: the one fact that, once known, would flip the choice. ${READ_ONLY}`,
  obj({
    criteria: arr(obj({ criterion: str, observable: str })),
    crux: str,
    decision: str,
    options: arr(str),
    premises: arr(obj({ checked: { type: 'boolean' }, evidence: str, premise: str })),
  }),
);
if (!fr) return out('frame agent failed');
const FRAME = `Decision: ${fr.decision}\nOptions:\n${fr.options.join('\n')}\nCriteria:\n${fr.criteria.map((c) => `${c.criterion}, distinguished by ${c.observable}`).join('\n')}\nCrux: ${fr.crux}${a.context ? `\nRead: ${list(a.context)}` : ''}`;
const premisesUnchecked = fr.premises.filter((p) => !p.checked).map((p) => p.premise);

const weighed = await pipeline(
  fr.options,
  (o) =>
    run(
      'Advocate',
      name(o),
      `${FRAME}\n\nBuild the strongest honest case for one option, as if you held it: ${o}\nGather the evidence live: run it, measure it, read the actual source or docs; recall counts for nothing. Return each load-bearing claim separately, with its evidence and an open question whose answer settles it, worded so it neither reveals nor leans toward your answer ("which versions does it support?", never "does it support v3?"). State its real costs, how reversible it is once adopted, and the observation that would kill it. ${READ_ONLY}`,
      obj({
        claims: arr(obj({ claim: str, evidence: str, question: str })),
        costs: str,
        kill: str,
        reversibility: str,
      }),
    ),
  async (adv, o) => ({
    adv,
    att: await run(
      'Attack',
      name(o),
      `${FRAME}\n\nOption under scrutiny: ${o}\nAnswer each open question below, in order, from evidence you gather yourself: run it, measure it, read the source or docs; recall counts for nothing. Say plainly when you could not find out.\n${adv.claims.map((c, i) => `${i + 1}. ${c.question}`).join('\n')}\nThen run a premortem: this option was chosen and had failed six months on; give the most likely reasons. Last, try to trip this kill observation and report whether it occurred: ${adv.kill}\n${READ_ONLY}`,
      obj({
        answers: arr(obj({ answer: str, evidence: str })),
        kill: obj({ evidence: str, tripped: { type: 'boolean' } }),
        premortem: arr(str),
      }),
    ),
  }),
  async ({ adv, att }, o) => {
    const m = await run(
      'Attack',
      `check ${name(o)}`,
      `An advocate made these claims for the option "${o}". An investigator who never saw them answered an open question per claim. For each claim, in order: verified when the answer and its evidence bear it out, contradicted when they contradict it, unverified when they cannot settle it. Judge from the answer and its evidence alone, not from the claim's own support or from recall.\n${adv.claims.map((c, i) => `${i + 1}. Claim: ${c.claim}\nAnswer: ${att.answers[i]?.answer ?? 'none given'}\nEvidence: ${att.answers[i]?.evidence ?? 'none'}`).join('\n')}\n${READ_ONLY}`,
      obj({ statuses: arr(STATUS) }),
    );
    return {
      claims: adv.claims.map((c, i) => ({
        answer: att.answers[i]?.answer ?? '',
        claim: c.claim,
        id: `${name(o)} #${i + 1}`,
        status: m.statuses[i] ?? 'unverified',
      })),
      costs: adv.costs,
      kill: `${adv.kill} (${att.kill.tripped ? 'tripped' : 'not tripped'}: ${att.kill.evidence})`,
      name: name(o),
      premortem: att.premortem,
      reversibility: adv.reversibility,
    };
  },
);
fr.options.forEach(
  (o, i) =>
    weighed[i] || log(`${name(o)}: its advocate, attacker or checker died; excluded from judging`),
);
const options = weighed.filter(Boolean);
if (!options.length) return out('every option lost an agent', { crux: fr.crux, premisesUnchecked });
const status = Object.fromEntries(options.flatMap((o) => o.claims.map((c) => [c.id, c.status])));
const table = (o) =>
  `${o.name}\nCosts: ${o.costs}\nReversibility: ${o.reversibility}\nKill observation: ${o.kill}\nPremortem: ${o.premortem.join('; ')}\nClaims:\n${o.claims.map((c) => `[${c.id}] ${c.status}: ${c.claim} (investigator: ${c.answer})`).join('\n')}`;

phase('Judge');
const votes = (
  await parallel(
    Array.from(
      { length: JUDGES },
      (_, k) => () =>
        run(
          'Judge',
          `judge ${k + 1}`,
          `${FRAME}\n\nChoose among these options on the evidence below. Each claim came from the option's advocate and was checked by an investigator who answered it blind: weigh a contradicted claim against its option, and an unverified one as unknown, never as support.\n\n${[...options.slice(k % options.length), ...options.slice(0, k % options.length)].map(table).join('\n\n')}\n\nReturn your choice, your confidence, the one observation that would change your mind, the id of the claim your choice turns on (none when it turns on no listed claim), and the cheapest probe that would settle the crux. ${READ_ONLY}`,
          obj({
            change: str,
            choice: { enum: options.map((o) => o.name), type: 'string' },
            confidence: { enum: ['high', 'low', 'medium'], type: 'string' },
            crux: { enum: [...Object.keys(status), 'none'], type: 'string' },
            probe: str,
          }),
        ),
    ),
  )
).filter(Boolean);
const count = (n) => votes.filter((v) => v.choice === n).length;
const top = options.map((o) => o.name).sort((x, y) => count(y) - count(x))[0];
const open = votes.find((v) => status[v.crux] === 'unverified');
const majority = count(top) * 2 > JUDGES;
const dissent = votes.filter((v) => v.choice !== top).map((v) => `${v.choice}: ${v.change}`);
return out(
  open
    ? `the crux rests on unverified claim ${open.crux}: run the probe`
    : !majority
      ? 'no majority'
      : dissent.length
        ? `split; dissent: ${dissent.join(' · ')}`
        : count(top) === JUDGES
          ? 'unanimous'
          : 'majority of the judges that returned',
  {
    crux: fr.crux,
    options,
    premisesUnchecked,
    probe: (open ?? votes.find((v) => v.choice === top))?.probe ?? null,
    split: majority && count(top) < JUDGES,
    verdict: majority && !open ? top : null,
    votes,
  },
);
