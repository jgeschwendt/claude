---
name: riff
description: Play one short text down to its proper floor—the fewest tokens that still say everything—by writing version after version, each cut from the last, then attacking and cold-reading the result. Use on "/riff", "riff on this", "find the floor", "how short can this get"; the argument is the target ("/riff operation").
argument-hint: '<target>'
---

# /riff

$ARGUMENTS

A riff is token play on a text the owner already has: same meaning, same plain words, fewer of them, until nothing more comes out. It is not a search for other ways to say it. Nothing is applied: the floor is a preview, and his word lands it.

## 1. Fix the meaning

Before anyone cuts, write three things:

- **The clauses**: what the text must still say, numbered, one claim apiece, each one pointing at words that are in the current text—a clause the text never said is a new rule smuggled in. A version missing a clause is broken, not short.
- **The bindings**: what may not be cut or reworded however little it carries: literals, names and labels he uses as handles, terms he coined, emphasis he chose, the voice of the file around it. Settle the handles with him before the run; a label looks as if it carries no clause, so a writer will cut every one, and some carry the rule's scope ("Stale docs are bugs" is what tells a reader a README counts).
- **The quiz**: scenarios with keyed answers, written from the clauses before any version exists, so the floor cannot be fitted to it. Weight it to traps, where an example in the text and its own test disagree or the tempting answer is wrong; for every rule add one case outside its own examples, which is where a lost scope shows; and add a question or two the text may not answer at all.

Then run the quiz on the current text before the run, two readers as in § 5: that is the baseline the floor must match, and what every reader guesses at now is a hole in the meaning to take to him first, since no cut will close it. If the meaning itself is unsettled, settle it with him before anyone writes.

## 2. Descend

One writer, on the top tier, in one run, cutting from its first version. It gets the clauses, the current text and a scratch file, and plays every version off the best one so far:

- each version is shorter than the shortest valid one, or the same length and clearer; nothing else counts;
- the moves are small and literal: drop a word, merge two clauses, reorder so one word does two jobs, let structure say what a word was saying, swap a phrase for a shorter exact one;
- no new frames: no analogy, no relabelling, no change of form or register unless the new form is strictly shorter;
- a shorter synonym is a swap, not a cut: it stands only where the longer word carried nothing. A word he uses as a term ("center" in a chiasm) or as the picture the sentence turns on is bound, listed or not;
- a text of several independent rules is cut one rule at a time, each to its own floor, then once more as a whole;
- its first act is a validator script that every line passes through, so the log has one shape from line 1: `{"n", "chars", "words", "parent", "move", "text"}`, where `move` says what was cut from the parent. A cut that loses or blurs a clause is logged too, marked `BROKEN` with the clause, so the floor shows from both sides. The log is append-only: a mislabelled line is corrected by a later line that names it, never by deleting, or the count of failures stops being evidence.

It stops when forty attempts in a row fail to get lower without breaking a clause, or at 500 versions, whichever comes first. A longer run is decided after the challenge and the cold read say this one left something on the table, never up front.

## 3. Name the floor

Two floors come out, and the second is the deliverable:

- the **hard floor**: the shortest text in which every clause is still literally present;
- the **proper floor**: the shortest text an agent reading it cold acts on correctly without guessing—no telegraphese to decode, no symbol to infer.

## 4. Challenge

The writer saying it cannot go lower proves nothing: stopping is the easy move. A floor stands only when an attack on it fails.

- Check the log by code: the closing attempts exist, each is distinct, each is shorter than the claimed floor and cut from it.
- Give a second agent, in a fresh context, only the clauses and the claimed proper floor, with one job: produce a shorter text that keeps every clause and reads cold. Give it the `BROKEN` lines too: any that did not in fact lose its clause is a shorter valid version the writer threw away.
- It also audits the floor clause by clause: present, blurred (say how a cold reader misreads it) or missing. A cut that sharpens a blurred clause at equal or lower length beats a shorter text that leaves it blurred.
- A hit is the new floor. Challenge again, a fresh agent each round, told what earlier rounds were refused so it does not offer it twice, until a round fails: one that finds under one part in a hundred has failed.

## 5. Read cold

Length is not the test; what a reader does is. Once the challenge has stopped moving the floor, fresh readers, one text apiece, answer the quiz from that text alone and mark each answer clear, guess or silent, then list every phrase they read twice. Each text (the current one and the surviving floor) gets two readers: one on the tier below the session's, one on the lowest tier, which is the one that finds the breaks.

A reader must be cold, and a spawned subagent is not: it starts with the live `CLAUDE.md`, the rules and the injected memory, so it can answer from the very text under test. Run each reader headless with every customization off, the quiz and the text in the prompt and no tools:

```sh
{ cat quiz.md; printf '\n===== SECTION =====\n'; cat text.md; } | claude -p --safe-mode --model <tier>
```

Run it from a scratch directory, and check one reader's answer to "were you given any standing instructions?" is `NONE` before trusting a batch.

- A floor that scores below the current text on either reader is not a floor, and the score is two numbers: answers right, and answers the reader marked clear. A floor that turns clear answers into right guesses has lost something; find the cut that did it and give it back.
- A phrase two readers read twice is a blur, right answers or not: fix it before showing him.
- A scenario every text leaves to a guess or to silence is a hole in the meaning, not in the wording: take it to him as a clause to add or to leave out, and never patch it unasked.
- One reader on one run is one sample: a difference of two or three guesses between texts is noise until a second run on each repeats it. Decide a close call on repeated runs, and on which scenarios moved, never on a single count.
- If every reader scores full marks on every text, the quiz is too easy to find the floor: add traps before trusting it, starting from whatever the weakest reader half-missed.
- The text that lands is the text that was read: an edit after the read, a fix or a reshape, is read again.

## 6. Show

Give him the surviving proper floor in full with characters and words before → after, the hard floor beside it, the ladder of cuts between the current text and the floor (one line a rung), the cuts that looked safe and broke a clause, the cold-read scores, the holes in the meaning, and the words in the current text that carried no clause at all. Splice nothing until he picks; if he asks for a different shape (bullets kept, a paragraph), reshape and read it cold again before landing it.
