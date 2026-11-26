---
name: show
description: Put a decision, findings, a table or a choice of options in front of the owner as a live plan at http://127.0.0.1:7469/<slug>, and talk with him through it question by question until each is resolved. Use on "show me", and on anything complicated that would otherwise reach him as terminal prose — options to choose between, findings, tables, a proposal, a lesson in a language he is learning; the terminal carries one line and the link.
---

# /show

$ARGUMENTS

A plan is a JSON document: findings in an overview, then questions he answers; the daemon validates it, serves it, records every Send, Ask, Resolve and hud comment, and pushes your replies to the page with no reload. Terminal prose is for one line and the link; anything with options, findings or a table goes in a plan.

```sh
S=~/.claude/skills/show/show   # every verb; `show` alone prints them
```

## The loop

1. Write the plan (below) and `$S open plan.json [--slug s]`: it validates (each problem names its question and field) and prints the URL.
2. Look at it headless before he does: `agent-browser` under your own `AGENT_BROWSER_SESSION`, desktop and `set viewport 420 900`; zero console errors, nothing clipped, no sideways scroll.
3. Open it for him, then tell him one line and the link: `show open` and `show update` open the tab in his browser themselves (`--quiet` when he already has it open); a link he has to carry from the conversation does little. (since 2026-11-23 · "you open the form, carrying the link in conversation does little, keep it there but open it for me")
4. `$S wait <slug>` as a background command; it blocks until his next event, prints it as one JSON line and exits. Re-arm it after every event: a cursor beside the form makes each event arrive exactly once.
5. Act on each event as it arrives; each is one JSON line `[kind, props]`, with `at` and `n` (its place in the log) among the props. `["answer",{"question","picks"?,"notes"?,"message"?}]` is a Send or Ask with at least one of them: `picks` `{"<choice id>": ["<value>", …]}` has each choice he picked on, one value for a pick-one choice and the values in authored order for a `pick: "many"` one (a choice with no pick is absent), and `notes` `{"<choice id>": {"<value>": "text"}}` the comments he wrote on single options, picked or not (since 2026-11-24 · "i also want an input with each option in case i want to comment, click to reveal and focus so the input doesnt take up too much visual space"; keyed by choice id since 2026-11-25 · "options should be in the body too, a card can have n - single or multi options"; "picks keyed by choice id"); `["comment",{"question"?,"text","thread"}]` is a comment he left through hud. `["resolve",{"question"}]` is his own Resolve on the question: it is already collapsed and its threads closed, so note it and move on. (since 2026-11-24 · "how do i resolve this?") A factual claim in his question is answered with a probe, not recall.
6. Answer on the question: `$S reply <slug> <question|thread> [--working] <text…>`. A question he last spoke on waits under "Waiting on the agent" below the untouched ones; a plain reply lifts it to the top, his move next, read from hud's threads, so a reload keeps the order. (since 2026-11-24 · "after i send, the card should move to the bottom until you respond and place it back up top if i need to see it again") Reply with `--working` when the question is answered but work is still in flight and nothing is asked of him: it sits under "Agent working" with your reply showing until a plain reply hands it back, or his next word makes it wait on you. (since 2026-11-24 · "card shows waiting on me?") Keep the status lines atop Tasks current: `$S status <slug> <line>…` replaces them. Add or change questions with `$S update <slug> plan.json`; nothing he has said is lost. When a reply changes the picture (a probe corrected the question, his comment opened a better option), rewrite that question's lead and options in the same step: options left describing the old picture read as a broken plan. (since 2026-11-24 · "why do my options not update after the context changes?") A reply is a few short lines, never a paragraph. (since 2026-11-24 · "format or diagram, block of text is hard to understand")
7. `$S resolve <slug> <question|thread>` when a question is settled (his Resolve button does the same): it collapses to one line at the bottom, and a new Send or Ask on it reopens it. `$S close <slug>` takes the plan off the index when all is done.

**A question is a thread, not a ballot.** He speaks on it, you probe and reply, he speaks again; work every thread from your side until you can state the architecture or the proposal, then put that on the plan as its own question for his word. A choice alone rarely settles a question. (since 2026-11-23 · "these cards are more like hud threads, we work the threads from your side until you can form the architecture/plan")

`$S list` shows open plans with their questions counted by turn (his, waiting on the agent, agent working); `$S health` the daemon's state and version. An error is `show: <code>: <message>`, exit 1; branch on the code: `ambiguous`, `booting`, `down`, `exists`, `hud_off`, `invalid`, `no_thread`, `not_found`, `stopping`, `unknown` (sent, outcome not known: check before repeating), `version` (the line names the fix).

## Authoring

A plan is the tuple `[title, overview, questions]`, a question `[title, body]` under its id, and every node inside is a part `[kind, props]` with an optional `title` among its props.

```json
[
  "Release #109",
  [
    [
      "chart",
      {
        "kind": "split",
        "rows": [
          ["green", 41],
          ["red", 1]
        ],
        "title": "Last runs"
      }
    ]
  ],
  {
    "land": [
      "Land it?",
      [
        ["note", { "text": "The branch is green." }],
        [
          "choice",
          {
            "id": "go",
            "options": { "land": { "label": "land it", "lean": true }, "hold": { "label": "hold" } }
          }
        ]
      ]
    ]
  }
]
```

**Findings go in `overview`; a question is only for something he answers.** `overview` is a list of context parts, what he is given to decide with (since 2026-11-25 · "lets change Display to Context, that's really what you are trying to provide me") (chart, code, compare, figure, list, machine, note, tabs) at the top of the page, each with a `title` (a note needs none) and its kind's props: no id, thread, message box or Send. (since 2026-11-24 · "this shouldn't be a card right? this should just be a chart at the top? and overview of the findings?")

**The page reads overview, tasks, a rule, questions, a rule, resolved.** The overview is what he decides with; tasks track the decision extraction's progress, every question a line linking to it, ☑ once resolved, under the status lines; the questions are the unresolved decisions, and resolved the settled ones. (since 2026-11-25 · "lets define some of the contracts: FORM: OVERVIEW TASKS --- CARDS --- RESOLVED"; overview "plan", tasks "decision extraction process progress", cards "unresolved")

**An explanation reaches him as pictures, not prose:** a `figure` drawn in the plan, with a short `note` for caption. (since 2026-11-24 · "pictures are how i understand") The picture is the real thing computed and unfolding step by step (SMIL animation in the `svg`, data from a script), never boxes and arrows standing in for it. (since 2026-11-24 · "use d3 or something complex this means little to me, show this unfold")

**A question's lead is one or two short sentences,** a `note` first in its body. Detail goes in a `list` context's `items` in the question's `body`, a chart or a `machine` diagram, never a paragraph. (since 2026-11-24 · "this is hard to follow, structure or use diagrams")

**A question is a composition of parts:** its id is its key in `questions` (a letter, then letters, digits, `-`, `_`; never a whole number, which JS hoists ahead of the other keys), its value `[title, body]`, `body` a list of the contexts below and any number of `choice` parts, each with an optional `title` shown as a small heading, drawn in order. A decision is a question with a leading `note` and a `choice` in its body. A `choice` is `["choice", {id, options, pick?, title?}]`: `id` (a letter, then letters, digits, `-`, `_`) distinct within the question, `pick` `"one"` (the default) or `"many"`, and `options` a record keyed by value, `{"<value>": {label, lean?: true, hint?, shape?}}` (`shape` is an SVG path `d` in a 0 0 100 100 box, drawn beside the label): key order is display order, so a value is never a whole number and never repeats; exactly one lean on a pick-one choice and any number on a pick-many one, each shown ★; `hint` is one dim line under the label. A choice is question-body only: the overview rejects it, being unanswerable. Each choice draws where it sits in the body, so a question asks as many things as it has choices, one pick-one and one pick-many alike. On a pick-one choice each option ends in a ✎ that opens a one-line comment inline beside the label and becomes a ↵: ↵, or Enter in the comment, sends just that option and its comment as one `answer`; an option, its comment and its ✎/↵ share one outline. A pick-many choice's options carry no ✎: one tall ↵ beside them sends that choice's picks. Every question gets a message box with Ask and a Resolve beside it, and its hud thread; Ask submits every choice's picks, option comments and the message as one `answer`. The hud thread line names each choice's picks (its `title` or `id`, then the labels). (since 2026-11-24 · "i want the send button here, change the current send button to \"ask\""; 2026-11-25 · "the pencil should expand into this and become a submit button itself", "pick many shouldn't have the same individual submits as the single choice type", "make it one outline not two", "make all 4 of these pencils become one tall submit icon"; 2026-11-25 · "options should be in the body too, a card can have n - single or multi options"; "picks keyed by choice id")

**Never bundle choices into one option** ("the starred four", "all six"): each pickable item is its own option, with `pick: "many"` on the choice when they are independent, and a separate `choice` when they are separate decisions. (since 2026-11-24 · "give me the options to pick, not the starred four")

**A question that grows into several is replaced, not followed.** When one question's answer needs a question per item, title each new question with the parent's name and its place (`Lint pairs · 3 of 4`), say so in a reply on the parent, and resolve the parent in the same update; a summary question left above its children reads as one more to answer. (since 2026-11-24 · "the ui does not make it obvious you created child cards for this, confused me")

**Options are suggestions; his own words are always a full answer.** Nothing is preselected, a second tap takes a choice back, and a send needs a pick, a message or an option comment. (since 2026-11-24 · "this input needs a custom message next time i don't want to have to select 1")

| kind      | props, each with `title?` besides                                            |
| --------- | ---------------------------------------------------------------------------- |
| `chart`   | `kind` `"bar"` or `"split"`, `rows` `[[label, value ≥ 0], …]`                |
| `choice`  | question body only: `id`, `options`, `pick?` `"one"`/`"many"`                |
| `code`    | `code`, `lang?`                                                              |
| `compare` | `pair` `[today, alternative]` side by side, `lang?`                          |
| `figure`  | `svg` (an `<svg viewBox>`, drawn in the page)                                |
| `list`    | `items` `[string]`                                                           |
| `machine` | `machine` an xstate config, or `[string]` steps + `loop?`; `walk?` `[event]` |
| `note`    | `text`                                                                       |
| `tabs`    | `tabs` ≥2 of `[label, code]` or `[label, code, lang]`, labels distinct       |

The contexts above go in a question's `body` and in `overview` alike, `choice` in a question's `body` only. A `machine` is drawn on the server, states and labelled events with the `walk` (default: the longest simple path, or every step) lit in turn; a list of steps is a chain of unlabelled edges, and a bad config or an event the walk cannot send fails validation. (since 2026-11-25 · "replace steps … provide a shorthand for steps"; xstate: "way more out of the box for machine control types") `example.json` beside this file uses every kind. `lang` is a shiki language id (`rust`, `sh`, `ts`…); the daemon highlights the sample in greys, weight and italic with a faint hue per role, and without `lang` it stays plain.

**Teach** when the decision is in a language or area he is learning: a question of a leading `note` (the plain statement), `body: [note(…), compare(pair today → alternative, lang), note("Cost: …"), choice(…)]`. Every code sample compiles: prove it before it goes on the plan.

**A lint or style decision shows the code each option makes him write**, one labelled sample per option as `code` contexts in the question's `body`, not only the rule names. (since 2026-11-24 · "show me lint decisions with code samples too")

**A new component** when none explains the thing well: add its verax part to the `contexts` list and `KINDS`, and its body to `BODIES`, in `catalog.tsx`, a use of it to `example.json`, run `bun test --coverage --cwd ~/.claude/skills/show` (the subcommand first; `bun --cwd … test` runs the repo's gate), then restart the daemon (below).

## No browser streams

Live changes ride WebSockets only, hud's and show's: never an EventSource, a polling loop or a long-lived fetch in the page. Chromium allows 6 streams per host:port shared by every tab and 255 WebSockets per browser (measured 2026-11-23 · Chromium); a seventh open plan would hang and read as a bug. A test fails on either in the client.

## The daemon

One process on 127.0.0.1:7469, launchd's `io.jlg.show` (KeepAlive) once `$S setup` has run: restart it with `launchctl kickstart -k gui/$(id -u)/io.jlg.show`, never a hand-started `$S serve` beside it (that is for a machine without the job, or a test daemon on its own `SHOW_PORT` and `XDG_STATE_HOME`). Plans live under `${XDG_STATE_HOME:-~/.local/state}/show/<slug>/` (`plan.json`, `answers.jsonl`, `status.json`). Threads come from `@jlg/hud`'s server, found at `SHOW_HUD` or in the sibling `typescript` checkout (`../../typescript/main/packages/hud/src/server.ts` from this repo); without it `health` says `degraded` and `reply` says `hud_off`. launchd starts the job without the shell's environment, so `SHOW_HUD=<hud's src/server.ts> $S setup` writes the path into the job, and setup refuses with `hud_off` while neither `SHOW_HUD` nor that default exists.
