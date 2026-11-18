export const meta = {
  name: 'reconsolidate-memories',
  description:
    'Dry run: revalidate every sandman memory against the live system and propose keep, revise, rehome or prune, with prune verdicts checked by a skeptic',
  whenToUse:
    'The sandman store needs a whole-store revalidation pass (the 2026-11-14 reconsolidation): "reconsolidate the memories", "revalidate sandman". args: {banks: [{bank, count}] (each bank of ~/.sandman/memories and its *.md count, MEMORY.md excluded), today: YYYY-MM-DD, out: a scratch dir}. It changes no memory: it writes review-NN.jsonl and refute-NN.jsonl verdicts to out; applying them is a separate, owner-approved step.',
  phases: [
    {
      title: 'Review',
      detail: 'one agent per ~30 memories: check each claim against the live system',
    },
    {
      title: 'Refute',
      detail: 'a skeptic tries to overturn each prune, revise and rehome verdict',
    },
  ],
};

const { banks, out, today } = args;
const SIZE = 30;
const chunks = [];
let cur = { n: 0, parts: [] };
for (const b of banks) {
  let start = 0;
  while (start < b.count) {
    const take = Math.min(SIZE - cur.n, b.count - start);
    cur.parts.push({ bank: b.bank, end: start + take, start });
    cur.n += take;
    start += take;
    if (cur.n >= SIZE) {
      chunks.push(cur);
      cur = { n: 0, parts: [] };
    }
  }
}
if (cur.n) chunks.push(cur);
log(`${chunks.length} chunks over ${banks.length} banks`);

const num = { type: 'number' };
const str = { type: 'string' };
const CHECK = {
  properties: { checked: num, file: str, notes: str, overturned: num },
  required: ['file', 'checked', 'overturned'],
  type: 'object',
};
const COUNTS = {
  properties: {
    file: str,
    keep: num,
    notes: str,
    prune: num,
    rehome: num,
    reviewed: num,
    revise: num,
  },
  required: ['file', 'reviewed', 'keep', 'revise', 'rehome', 'prune'],
  type: 'object',
};
const nn = (i) => String(i).padStart(2, '0');
const slices = (c) =>
  c.parts
    .map((p) => `- bank \`${p.bank}\`: files ${p.start}..${p.end - 1} of the sorted list`)
    .join('\n');

const review = (
  c,
  i,
) => `You are revalidating long-term memories in a personal memory store. This is a DRY RUN: you change no memory. Today is ${today}.

The store is \`~/.sandman/memories/<bank>/<file>.md\` (frontmatter: name, description, type user|feedback|project|reference, created, updated?, source; then a body). A bank's name is a filesystem path with \`/\` and \`.\` written as \`-\` (\`-Users-jlg--grove-code-jgeschwendt-grove\` is \`/Users/jlg/.grove/code/jgeschwendt/grove\`); repositories live under \`~/.grove/code/<owner>/<repo>/<worktree>\`, the trunk usually \`main\`. Bank names begin with \`-\`: always pass paths as \`./-Users…\` or after \`--\` so no tool reads them as flags.

Your slice (list each bank with \`ls ~/.sandman/memories/<bank>/\`, keep \`*.md\` except \`MEMORY.md\`, sort by name, take the index range):
${slices(c)}

For every memory in the slice, read it whole and decide one verdict, from evidence you gather now on this machine (read the files, configs, rules and repos it talks about; run read-only commands such as \`ls\`, \`rg\`, \`git -C <repo> log\`, \`--help\`). Never guess: a claim you could not check is \`keep\` with \`checked: false\`.
- \`keep\` — still true and still useful as written.
- \`revise\` — the substance holds but part is stale, wrong, or the name/description would not let a reader tell when it applies. Give the corrected \`name\`, \`description\` (one line, under 160 characters, says when it applies) and \`body\` (keep the owner's quoted words and dates; change only what the evidence requires).
- \`rehome\` — true, but filed in the wrong place: either another repository's bank (\`home\`: that bank's name) or general knowledge independent of any one project (\`home\`: \`knowledge/<topic-slug>\`, with \`kind\`: \`knowledge\` or \`playbook\`). A playbook is steps for a recurring task.
- \`prune\` — no longer true (the tool, file, rule or decision it describes is gone or reversed), fully duplicated by another memory you can name, superseded by a later memory you can name, or a one-off status note with no future use. Preferences and corrections the owner stated (type \`user\` or \`feedback\`) are pruned only when the owner's later words or the live rules contradict them; when unsure, keep.

The owner's standing rules live in \`~/.claude/CLAUDE.md\` and \`~/.grove/code/jgeschwendt/claude/main/rules/*.md\`: a memory that only repeats a rule already written there verbatim is a \`prune\` (name the rule's file); one that adds detail the rule lacks is a \`keep\`.

Write one JSON object per memory, one per line, to \`${out}/review-${nn(i)}.jsonl\` (create the directory if needed; write nothing else anywhere): \`{"bank","file","type","verdict","reason"(one sentence),"evidence"(what you checked and what you found, with the path or command),"checked":bool,"name"?,"description"?,"body"?,"home"?,"kind"?,"duplicate_of"?}\`.

Do not edit, move or delete any memory. Do not call any hosted or metered API. Do not print memory bodies in your reply. Return the output file path and the counts.`;

const refute = (
  r,
  i,
) => `A reviewer proposed changes to long-term memories; your job is to try to overturn the risky ones. This is a DRY RUN: you change no memory. Today is ${today}.

Read \`${r.file}\` (one JSON verdict per line; memories are at \`~/.sandman/memories/<bank>/<file>\` — bank names begin with \`-\`, so pass paths as \`./-Users…\` or after \`--\`). For every line whose verdict is \`prune\`, and every \`revise\` or \`rehome\`, read the memory whole and independently check the reviewer's evidence on this machine with read-only commands. Default to overturning when the evidence does not hold up:
- a \`prune\` stands only if you can confirm the thing is gone, reversed, or fully covered by the named memory or rule file (read that one too). Anything the owner said as a preference or correction survives unless contradicted by his later words or the live rules.
- a \`revise\` stands only if the new text loses no fact, quote or date that is still true and adds nothing the evidence does not show.
- a \`rehome\` stands only if the new home exists as a repository (for a bank) or the content really is independent of any one project (for knowledge).

Write one JSON line per verdict you checked to \`${out}/refute-${nn(i)}.jsonl\`: \`{"bank","file","verdict","stands":bool,"final":"keep"|"revise"|"rehome"|"prune","reason","evidence"}\`. Write nothing else anywhere; edit no memory; call no hosted or metered API; do not print memory bodies in your reply. Return the output file path, how many you checked and how many you overturned.`;

const results = await pipeline(
  chunks,
  (c, _c, i) =>
    agent(review(c, i), {
      label: `review:${nn(i)}`,
      model: 'opus',
      phase: 'Review',
      schema: COUNTS,
    }),
  (r, _c, i) =>
    r && r.prune + r.revise + r.rehome > 0
      ? agent(refute(r, i), {
          label: `refute:${nn(i)}`,
          model: 'opus',
          phase: 'Refute',
          schema: CHECK,
        }).then((v) => ({ refute: v, review: r }))
      : { refute: null, review: r },
);

const done = results.filter(Boolean);
const sum = (k) => done.reduce((t, x) => t + (x.review ? x.review[k] : 0), 0);
if (done.length < chunks.length)
  log(`${chunks.length - done.length} chunks returned nothing and are not covered`);
return {
  chunks: chunks.length,
  covered: done.length,
  keep: sum('keep'),
  out,
  overturned: done.reduce((t, x) => t + (x.refute ? x.refute.overturned : 0), 0),
  prune: sum('prune'),
  rehome: sum('rehome'),
  reviewed: sum('reviewed'),
  revise: sum('revise'),
};
