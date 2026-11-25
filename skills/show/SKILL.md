---
name: show
description: Put a decision, findings, a table or a choice of options in front of the owner as a live form at http://127.0.0.1:7469/<slug>, and talk with him through it card by card until each is resolved. Use on "show me", and on anything complicated that would otherwise reach him as terminal prose — options to choose between, findings, tables, a proposal, a lesson in a language he is learning; the terminal carries one line and the link.
---

# /show

$ARGUMENTS

A form is a JSON document: findings in an overview, then cards he answers; the daemon validates it, serves it, records every Send, Ask, Resolve and hud comment, and pushes your replies to the page with no reload. Terminal prose is for one line and the link; anything with options, findings or a table goes in a form.

```sh
S=~/.claude/skills/show/show   # every verb; `show` alone prints them
```

## The loop

1. Write the form (below) and `$S open form.json [--slug s]`: it validates (each problem names its card and field) and prints the URL.
2. Look at it headless before he does: `agent-browser` under your own `AGENT_BROWSER_SESSION`, desktop and `set viewport 420 900`; zero console errors, nothing clipped, no sideways scroll.
3. Open it for him, then tell him one line and the link: `show open` and `show update` open the tab in his browser themselves (`--quiet` when he already has it open); a link he has to carry from the conversation does little. (since 2026-11-23 · "you open the form, carrying the link in conversation does little, keep it there but open it for me")
4. `$S wait <slug>` as a background command; it blocks until his next event, prints it as one JSON line and exits. Re-arm it after every event: a cursor beside the form makes each event arrive exactly once.
5. Act on each event as it arrives. `{"kind":"answer","card","choice"?|"choices"?,"message"?,"notes"?}` is a Send or Ask with at least one of them: `choice` on a pick-one card, `choices` (authored order) on a `pick: "many"` one, and `notes` `{"<value>": "text"}` the comments he wrote on single options, picked or not (since 2026-11-24 · "i also want an input with each option in case i want to comment, click to reveal and focus so the input doesnt take up too much visual space"); `{"kind":"comment","card"?,"text","thread"}` is a comment he left through hud. `{"kind":"resolve","card"}` is his own Resolve on the card: it is already collapsed and its threads closed, so note it and move on. (since 2026-11-24 · "how do i resolve this?") A factual claim in his question is answered with a probe, not recall.
6. Answer on the card: `$S reply <slug> <card|thread> [--working] <text…>`. A card he last spoke on waits under "Waiting on the agent" below the untouched ones; a plain reply lifts it to the top, his move next, read from hud's threads, so a reload keeps the order. (since 2026-11-24 · "after i send, the card should move to the bottom until you respond and place it back up top if i need to see it again") Reply with `--working` when the card is answered but work is still in flight and nothing is asked of him: it sits under "Agent working" with your reply showing until a plain reply hands it back, or his next word makes it wait on you. (since 2026-11-24 · "card shows waiting on me?") Keep "where things stand" current: `$S status <slug> <line>…` replaces the list. Add or change cards with `$S update <slug> form.json`; nothing he has said is lost. When a reply changes the picture (a probe corrected the card, his question opened a better option), rewrite that card's text and options in the same step: options left describing the old picture read as a broken form. (since 2026-11-24 · "why do my options not update after the context changes?") A reply is a few short lines, never a paragraph. (since 2026-11-24 · "format or diagram, block of text is hard to understand")
7. `$S resolve <slug> <card|thread>` when a card is settled (his Resolve button does the same): it collapses to one line at the bottom, and a new Send or Ask on it reopens it. `$S close <slug>` takes the form off the index when all is done.

**A card is a thread, not a ballot.** He speaks on it, you probe and reply, he speaks again; work every thread from your side until you can state the architecture or the plan, then put that on the form as its own card for his word. A choice alone rarely settles a card. (since 2026-11-23 · "these cards are more like hud threads, we work the threads from your side until you can form the architecture/plan")

`$S list` shows open forms with their cards counted by turn (his, waiting on the agent, agent working); `$S health` the daemon's state and version. An error is `show: <code>: <message>`, exit 1; branch on the code: `ambiguous`, `booting`, `down`, `exists`, `hud_off`, `invalid`, `no_thread`, `not_found`, `stopping`, `unknown` (sent, outcome not known: check before repeating), `version` (the line names the fix).

## Authoring

```json
{
  "title": "…",
  "text": "optional intro",
  "overview": [
    { "component": "chart", "kind": "bar", "title": "…", "rows": [{ "label": "…", "value": 3 }] }
  ],
  "cards": [
    {
      "component": "decision",
      "id": "land",
      "title": "…",
      "text": "…",
      "options": [
        { "label": "land it", "lean": true, "value": "land" },
        { "label": "hold", "value": "hold" }
      ]
    }
  ]
}
```

**Findings go in `overview`; a card is only for something he answers.** `overview` is a list of display blocks (chart, code, figure, list, note, steps) at the top of the page, each with `title`, `text?` and its component's fields: no id, thread, message box or Send. (since 2026-11-24 · "this shouldn't be a card right? this should just be a chart at the top? and overview of the findings?")

**An explanation reaches him as pictures, not prose:** a `figure` drawn in the form, with a short caption. (since 2026-11-24 · "pictures are how i understand") The picture is the real thing computed and unfolding step by step (SMIL animation in the `svg`, data from a script), never boxes and arrows standing in for it. (since 2026-11-24 · "use d3 or something complex this means little to me, show this unfold")

**Card text is one or two short sentences.** Detail goes in a list's `items` (a `list` card takes `options` too), a chart or a `steps` diagram, never a paragraph. (since 2026-11-24 · "this is hard to follow, structure or use diagrams")

Every card takes `id` (a letter, then letters, digits, `-`, `_`), `title`, `meta?` (a small line above the text), `pick?` (`"one"`, the default, or `"many"`) and `options?`: `[{label, value, lean?: true, hint?, shape?}]` (`shape` is an SVG path `d` in a 0 0 100 100 box, drawn beside the label), values distinct, exactly one lean on a pick-one card and any number on a pick-many one, each shown ★; `hint` is one dim line under the label. Every option gets a ✎ that opens a one-line comment under it. Every card gets a message box with Ask, a Resolve beside it and its hud thread; a card with options also gets Send right under them. Send and Ask submit the same thing (picks, option comments and message) as one `answer`, and Enter in an open ✎ comment sends too. (since 2026-11-24 · "i want the send button here, change the current send button to \"ask\"")

**Never bundle choices into one option** ("the starred four", "all six"): each pickable item is its own option, with `pick: "many"` when they are independent. (since 2026-11-24 · "give me the options to pick, not the starred four")

**A card that grows into several is replaced, not followed.** When one card's answer needs a card per item, title each new card with the parent's name and its place (`Lint pairs · 3 of 4`), say so in a reply on the parent, and resolve the parent in the same update; a summary card left above its children reads as one more question. (since 2026-11-24 · "the ui does not make it obvious you created child cards for this, confused me")

**Options are suggestions; his own words are always a full answer.** Nothing is preselected, a second tap takes a choice back, and Send or Ask needs a pick, a message or an option comment. (since 2026-11-24 · "this input needs a custom message next time i don't want to have to select 1")

| component  | fields                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| `chart`    | `kind` `"bar"` or `"split"`, `rows` `[{label, value ≥ 0}]`, `text?`                     |
| `code`     | `code`, `text?`                                                                         |
| `decision` | `text`, `options` (required)                                                            |
| `figure`   | `svg` (an `<svg viewBox>`, drawn in the page), `text?` caption                          |
| `list`     | `items` `[string]`, `text?`                                                             |
| `note`     | `text`                                                                                  |
| `steps`    | `items` `[string]`, boxes joined by arrows; `loop?: true` returns to the first, `text?` |
| `teach`    | `text`, `pair` `[today, alternative]`, `cost`, `options` (required)                     |

`decision` and `teach` are cards only; the rest also go in `overview`. `example.json` beside this file uses every component.

**Teach** when the decision is in a language or area he is learning: the plain statement, his own code today → the alternative, what the change costs, then the choice. Every code sample compiles: prove it before it goes on the card.

**A lint or style decision shows the code each option makes him write**, one labelled sample per option in a `code` card beside it, not only the rule names. (since 2026-11-24 · "show me lint decisions with code samples too")

**A new component** when none explains the thing well: add its fields to `DISPLAYS` (or `SCHEMAS` for a card-only question) and its body to `BODIES` in `catalog.tsx`, a use of it to `example.json`, run `bun test --coverage --cwd ~/.claude/skills/show` (the subcommand first; `bun --cwd … test` runs the repo's gate), then restart the daemon (below).

## No browser streams

Live changes ride WebSockets only, hud's and show's: never an EventSource, a polling loop or a long-lived fetch in the page. Chromium allows 6 streams per host:port shared by every tab and 255 WebSockets per browser (measured 2026-11-23 · Chromium); a seventh open form would hang and read as a bug. A test fails on either in the client.

## The daemon

One process on 127.0.0.1:7469, launchd's `io.jlg.show` (KeepAlive) once `$S setup` has run: restart it with `launchctl kickstart -k gui/$(id -u)/io.jlg.show`, never a hand-started `$S serve` beside it (that is for a machine without the job, or a test daemon on its own `SHOW_PORT` and `XDG_STATE_HOME`). Forms live under `${XDG_STATE_HOME:-~/.local/state}/show/<slug>/`. Threads come from `@jlg/hud`'s server, found at `SHOW_HUD` or in the sibling `typescript` checkout (`../../typescript/main/packages/hud/src/server.ts` from this repo); without it `health` says `degraded` and `reply` says `hud_off`. launchd starts the job without the shell's environment, so `SHOW_HUD=<hud's src/server.ts> $S setup` writes the path into the job, and setup refuses with `hud_off` while neither `SHOW_HUD` nor that default exists.
