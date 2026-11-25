---
paths:
  - '**/*.{html,md}'
---

# Stamps

- **A stamp cites portable provenance**—a repo-relative file or the primary source (arXiv, URL), never a machine-local path.
- **`(since <date> · <source>)`** — origin: when a rule or standing claim was introduced or its meaning last changed, plus the artifact that grounds it.
- **`(verified <date>)`** — the last live check of a claim. Verifying an `(unverified …)` claim replaces its marker with this.
- **`(unverified <date> · <reason>)`** — custody was owed and the claim couldn't be checked; a dated, greppable debt instead of silent trust.
- **`(measured <date> · <source>)`** — a number this run derived rather than read: a count, a ratio, a benchmark. The source names what was counted, so a later editor can re-derive it. (since 2026-07-30 · /tighten corpus sweep, keyword precedent set across the giga family)
- **`(fetched <date>)`** — a primary doc retrieved and quoted that day; verifies the quotation, not the behavior it describes. (since 2026-07-30 · /tighten corpus sweep D-7)
- **`(observed <date>)`** — an incident seen live, once; the observation is its own source — weaker than a re-runnable `verified` probe. (since 2026-07-30 · /tighten corpus sweep D-7)
- **`(reconciled <date> · <source>)`** — two artifacts conflicted; records the settlement and the side that won. (since 2026-07-30 · /tighten corpus sweep D-7)
- **`user/CLAUDE.md` carries no stamps**: it loads into every session, so provenance there is `git blame`, never a `(since …)` or a measured count in the line. (since 2026-11-25 · "remove the stamps from my user claude, we don't need to waste the tokens here, we can just use git blame for these few files")
- **Stamp dates are ISO (`2026-07-19`)** — never the `MM/DD/YY` commit-subject format; the two are deliberately distinct.
- **Stamp what a future editor must re-ground** — rules, standing claims, incident-derived exceptions; skip prose whose truth doesn't age. (since 2026-07-19 · the `(since …)` shape recurred across rules/ and skills/ with no defining doc)
