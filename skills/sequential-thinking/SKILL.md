---
name: sequential-thinking
description: Load before committing to an answer someone will rely on when the problem has competing explanations or real tradeoffs — a diagnosis or root cause, a choice between designs, libraries or migration paths, an estimate, a plan, a verdict on whether a claim is true — and when a settled answer is challenged ("are you sure?"). Also on "think this through", "reason carefully", "what's really going on", or after the problem has already surprised you once. Not for lookups or fixes with one obvious answer.
---

# Sequential thinking

$ARGUMENTS

Work the problem as numbered thoughts in the reply, so each one can be cited, revised (`revise → #3`) or branched, and so he can audit the chain. Size the chain to the stakes: a reversible call gets a few thoughts, a one-way door gets every step below.

1. **Frame.** Restate the problem in your own words, without the causal vocabulary it arrived in: "why is the cache slow?" has already named a suspect. State what done looks like, and which premises you were handed rather than checked.
2. **Rivals.** List every explanation or option that fits what is known, including the boring one. Before gathering evidence, give each the observation that would kill it, one its rivals do not predict.
3. **Ground.** Go and get the discriminating observations. Check a claim as high on this ladder as its weight demands:
   - **External**: run it, measure it, read the actual file, ask. Nothing below overturns this.
   - **Factored**: re-derive the result by a different route, or answer open questions ("which indexes exist on `returns`?", never a yes/no) from the raw evidence with your draft out of view.
   - **Introspective**: re-reading your own chain. Hygiene, never sufficient.
4. **Gate.** Before concluding: every claim the answer rests on has been checked externally or by a factored route; you looked where disconfirming evidence would live, and for what should be present if the answer were true but is not; and the strongest rival was tested as if you held it, not argued against for show. For an irreversible call, give a fresh agent the evidence without your chain or your favourite, and compare conclusions; for an irreversible choice between options, run `/gigadecide`, and for a failure whose cause is unknown, `/gigadebug`.
5. **Conclude.** Give the answer, the confidence with one line on why, what would change your mind, and what remains unverified. Confidence is capped by the highest rung used: a claim checked only by re-reading cannot carry "high". When the deciding evidence cannot be had, do not manufacture confidence: recommend what is safe under every live rival, or name the cheapest probe that would settle it.

A verdict moves on evidence, not on pressure. When it is challenged, ask what is new. New information or a named flaw goes back through step 3. Bare doubt gets one factored check of the most load-bearing claim, then you hold or revise on what that check showed, never on the pushback itself.
