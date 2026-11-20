---
name: artifacts
description: Draw a docs figure in the page itself — live HTML/SVG or a d3 chart on the gigantic design system's tokens — with no canvas, no export and no image file.
when_to_use: >
  Use when a docs page (docs/index.html, docs/<name>.html) needs a figure,
  diagram or chart: "add a figure", "draw a diagram for the docs", "the docs
  need a chart", "/artifacts", or a brief that names a figure slot. Not for UI
  mockups or taste previews before building (Claude Design), not for charts
  inside a product (that product's own chart conventions), not for README or
  markdown (no figures there).
argument-hint: '[page] [what the figure must show]'
---

# /artifacts — a docs figure drawn in the page

A figure is real DOM in the docs page: themed by the design system's tokens, readable as text, and pinnable per element by the `@jlg/hud` comment layer. Nothing is drawn elsewhere and exported.

## Inputs

- `$page` — the docs page that gets the figure. Missing and not obvious from the conversation → ask which page, in one line, before drawing.
- `$subject` — what the figure must show. Missing → ask; never draw a placeholder.

## Steps

### 1. Decide whether it is a figure

- Draw one when the content is a shape: a flow, a lifecycle, layers, a timeline, a state machine, a distribution.
- A comparison of attributes is a table. A sequence of three steps is a sentence. Neither is a figure.
- One figure per idea. A second figure that restates the first, or restates a table beside it, is deleted, not kept as a second view.

**Success criteria**: one sentence names the shape the figure shows and why prose or a table cannot.

### 2. Pick the form

| Content                                                                | Form                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Narrative with a fixed handful of parts: stations, layers, a lifecycle | static figure: inline HTML boxes or one inline `<svg>`     |
| Anything that is data, repeats, or has more than about eight nodes     | d3 chart drawn from `docs/data/<name>.json`                |
| The output of a command the repo ships                                 | d3 chart over a sample file a test pins to the real output |

Never both forms for the same content.

<example>
user: "the docs need a figure of how a session becomes a memory file"
assistant: <thinking>Five named stations in a fixed order, each with a sentence. That is narrative with a handful of parts, not data: a static figure. The page already has a d3 flow chart of files and verbs — if my stations repeat its nodes, the right move is to extend that chart, not add a second picture of the same thing.</thinking>
Reads the page first, finds the existing flow chart covers the same nodes, and adds the missing stations to its data instead of drawing a new figure.
<commentary>
The pull is to draw what was asked. Reading the page first is what catches the duplicate; a figure that mirrors an existing chart is a second copy to keep in step.
</commentary>
</example>

**Success criteria**: the form is named, and the page has been read for an existing figure or chart covering the same content.

### 3. Draw it

- **Container**: `<figure>` holding the drawing and a `<figcaption>` of one or two sentences. No heading inside; the section's heading is the title.
- **Boxes**: `--ui-surface` fill, `1px` `--ui-border`, `--ui-radius-lg`; a raised or selected box uses `--ui-surface-raised` and `--ui-border-strong`. Padding from the `--ui-space-*` scale.
- **Emphasis**: a static figure has one accent, `--ui-accent` with `--ui-accent-fg` ink, for the one thing it is about. A chart that already colours by category keeps `--ui-accent` for focus and selection only, and sets a group apart by shape: a dashed border, a heavier stroke. `--ui-ok`, `--ui-warn`, `--ui-danger`, `--ui-info` keep their meanings and are never used as series colours.
- **Order**: when the parts have a sequence, lead each label with a bare circled number (① ②); no word like "step" or "stage" in front of it.
- **Type**: `--ui-font-mono` for names, paths, commands and values; `--ui-font-sans` for sentences. Nothing under 12px. `--ui-fg` for content, `--ui-fg-muted` for secondary, `--ui-fg-faint` for decoration only, never the sole carrier of meaning.
- **Arrows**: a stroked `<path>` in `--ui-fg-muted` with one shared `<marker markerUnits="userSpaceOnUse">` (without it the head scales with the stroke width); an arrow means "flows to" and ends on the box it points at.
- **Width**: fluid to the page column. Under about 720px the drawing keeps its minimum width and scrolls inside its frame (`overflow-x: auto`); the page never scrolls sideways.
- **Charts**: one ES module per chart in `docs/charts/`, over a shared `lib.js` that owns the fetch, the legend, the table toggle, the tooltip and the redraw on resize. Data lives in `docs/data/`. d3 7.9.0 loads once from cdnjs as the page global. Text enters through d3's `.text`, never as HTML. Precedent: jgeschwendt/sandman `docs/charts/lib.js`, `docs/charts/flow.js`, `docs/index.html`.

**Success criteria**: every colour, radius, space and font in the drawing is a `--ui-*` token or a `--kind-N` slot from step 4; no element is an image.

### 4. Theme it

- Tokens only, so light and dark both work with no second drawing.
- A chart that needs categorical colours declares them once per page as `--kind-1` … `--kind-N` on `.chart`, in both themes. New or changed slots are validated with the dataviz skill's palette validator (load that skill for the command) against `--ui-bg` and `--ui-surface` in each theme; slots a page already carries are reused as they are. No other hex appears.
- Categories that must be told apart differ in lightness or shape as well as hue; a legend names each one in words.

**Success criteria**: a search of the figure's markup and CSS finds no hex outside the `--kind-N` declarations.

### 5. Word it

- Plain engineering language: label the mechanism (`the weekly review`), never a gloss or a program's poetic name.
- Labels you write are lowercase; explanations are sentences. Ids, paths, commands and anything read from data are verbatim.
- Sample data is synthetic and says so (`sample:` titles, obviously fake ids). Never real session titles, paths or names from a machine.

### 6. Make it accessible

- A static `<svg>` carries `role="img"` and an `aria-label` that says what it shows; decorative marks carry `aria-hidden="true"`. HTML boxes need no role: they are text.
- A chart offers its data as a table behind a toggle, and its marks are focusable (`tabindex="0"`) with the same detail on focus as on hover.
- Text is 4.5:1 on its ground in both themes; marks and borders that carry meaning are 3:1.

### 7. Pin sample data

Where a chart draws a command's output, its sample file is that command's output over a fixture, and a test fails when the two differ. A hand-written sample that drifts from the real shape is a bug the page cannot show.

### 8. Verify

1. Serve the docs directory over http (modules do not load from `file://`).
2. Load the page with `agent-browser` under your own `AGENT_BROWSER_SESSION`, at desktop and at phone width (`set viewport` takes width and height), in light and in dark (`document.documentElement.dataset.theme`); `scrollIntoView` the figure before each screenshot.
3. Read each screenshot: no clipped or overlapping text, arrows end on their boxes, nothing relies on a colour that vanished in the other theme.
4. At phone width confirm the page itself does not scroll sideways (`document.documentElement.scrollWidth === innerWidth`).
5. Confirm the console is clean.

**Success criteria**: four screenshots read, console clean, and the report says which were checked. A figure that was not looked at is not reported as done.

## Rules

- Nothing goes under `docs/figures/`: no PNG, no canvas source, no export script, no `figures` task. Replacing an exported figure deletes those files in the same change.
- A figure stays commentable per element: real DOM nodes, never one flattened image or a `<canvas>`.
- Do not draw in Claude Design for a docs page; its place is previewing a UI or a look before anything is built.
- Do not add a figure the page did not need to satisfy a brief's "with figures"; say the content is a table or a sentence and write that instead.
- Order a figure's data files and CSS declarations alphabetically unless order encodes meaning.

(since 2026-11-10 · the sandman rewrite's one exported figure cost a canvas, a repo copy and two PNGs that drifted within the hour: "drop it everywhere")
