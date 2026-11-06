# Question Playbooks

The question type determines the opening moves, what "done" looks like, and the characteristic traps. Identify the type in Phase 1 and follow the matching playbook; blended questions blend playbooks.

## Comparison / decision — "X vs Y", "which should we pick"

- **Done** = a recommendation against explicit criteria, with the runner-up's best case stated fairly.
- **First move: fix the criteria and weights before reading any vendor material**, derived from the user's actual use case. Otherwise the comparison inherits whatever criteria the loudest marketing emphasizes.
- Build the matrix — options × criteria — and make every cell cite.
- Hunt switchers and rejecters: people who migrated X→Y, or evaluated X and passed, write the densest material ("why we left X" posts, migration postmortems, forum threads).
- Trap: spec-sheet symmetry — comparing listed features instead of observed behavior. Practitioner reports beat datasheets.
- The crux to verify hardest: the criterion carrying the most weight for this user.

## Causal / explanatory — "why did X happen", "what's driving Y"

- **Done** = a ranked set of explanations with the evidence that discriminates between them.
- Run lightweight Analysis of Competing Hypotheses: list the plausible explanations up front — including the boring ones (measurement change, base-rate shift, selection effect, coincidence) — then hunt evidence that _distinguishes_ them. Evidence consistent with your favorite hypothesis is usually consistent with its rivals too; only diagnostic evidence moves the ranking.
- Track each hypothesis as a `claims.md` entry with evidence for and against.
- Prefer disconfirmation — the fastest progress is killing hypotheses, not accumulating support.
- Trap: narrative gravity. The most-retold story wins retellings, not evidence. Weight contemporaneous and primary accounts over retrospectives.

## Forecast — "will X happen", "where is Y headed"

- **Done** = calibrated likelihoods with stated drivers and the indicators that would change them.
- **Outside view first**: establish the base rate — how often do things in this reference class happen, how long do they usually take? Only then adjust with inside-view specifics.
- Decompose: what would have to be true, piece by piece, for the outcome? Research the pieces.
- Use aggregate signals where they exist (prediction markets, analyst estimate ranges, odds) as anchors, not oracles.
- Express likelihood numerically when it matters — "likely (~70%)" — because vague verbal odds hide real disagreement.
- The report must include a "What to watch" section: leading indicators that would update the forecast.
- Traps: extrapolating the recent trend; writing one scenario instead of a distribution.

## Due diligence — "should I trust X", "is X legit"

- **Done** = an integrity picture: the strongest evidence for and against, plus what the negative space says.
- **Adversarial-first**: search the negative case before the positive — "X lawsuit", "X complaint", "X fraud", "X SEC", "X recall", "X glassdoor". Positive material is optimized to rank; the negative case must be actively excavated.
- Registries beat reputation: corporate registries, court records, license databases, regulator enforcement lists, sanction lists.
- Follow the people: principals' histories, prior ventures, prior litigation.
- Negative space is evidence: an entity claiming scale but leaving no practitioner footprint — no forum mentions, no ex-employees, no complaints at all — is itself a finding.
- Trap: astroturf symmetry — glowing and scathing reviews can both be manufactured. Weight specific, verifiable, costly-to-fake signals.

## Landscape / state-of-the-art — "what's the state of X", "survey the field"

- **Done** = a taxonomy the reader can navigate, the current frontier with its trajectory, and the load-bearing actors named.
- Build the taxonomy early from hubs (review papers, awesome-lists, conference tracks) and let it structure the sub-questions; revise it when the evidence disagrees with it.
- Weight recency and date the frontier explicitly ("as of [month year]").
- Name the camps and their disputes: fields disagree along predictable lines, and mapping the disagreement _is_ the landscape.
- Trap: hub-era lag — reviews describe the field as of a year or more ago. Run the recency sweep on each branch of the taxonomy, not just the topic as a whole.
