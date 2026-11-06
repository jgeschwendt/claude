// The hook graph: events → hooks (grouped by file) → effects (one node per target, grouped by kind), laid out from
// docs/data/hooks.json, which scripts/charts.ts checks against register.tsx. d3 is the page's pinned global.
const d3 = globalThis.d3;
const root = document.getElementById("hook-graph");
const data = await (await fetch(new URL("../data/hooks.json", import.meta.url))).json();

const ROW = 24;
const GAP = 8;
const HEAD = 20;
const COLS = [180, 250, 170];

// column 2: hooks grouped by file, files in order of their first registration, the stubs last
const files = [...new Set(data.hooks.map((h) => h.file))].toSorted((a, b) => (a === "register.tsx") - (b === "register.tsx"));
const hooks = files.flatMap((file) => data.hooks.filter((h) => h.file === file));
const stack = (groups) => {
  let y = 0;
  const heads = [];
  const at = new Map();
  for (const [label, items] of groups) {
    heads.push({ label, y });
    y += HEAD;
    for (const item of items) {
      at.set(item, y);
      y += ROW + GAP;
    }
    y += GAP;
  }
  return { at, heads, height: y };
};
const hookCol = stack(files.map((file) => [file === "register.tsx" ? "register.tsx · stubs" : file, hooks.filter((h) => h.file === file)]));
const mid = (ys) => d3.mean(ys) ?? 0;

// column 1: events by the mean row of their hooks
const events = data.events
  .map((e) => ({ ...e, hooks: hooks.filter((h) => h.event === e.name) }))
  .toSorted((a, b) => mid(a.hooks.map((h) => hookCol.at.get(h))) - mid(b.hooks.map((h) => hookCol.at.get(h))));

// column 3: one node per (kind, target), state nodes from `writes`, grouped by kind in palette order
const effects = new Map();
for (const h of hooks) {
  for (const { kind, target } of [...h.writes.map((target) => ({ kind: "state", target })), ...h.effects]) {
    const key = `${kind}:${target}`;
    if (!effects.has(key)) effects.set(key, { key, kind, target, hooks: [] });
    effects.get(key).hooks.push(h);
  }
}
const kinds = data.kinds.map((k, i) => ({ ...k, slot: i + 1 }));
const byKind = kinds.map((k) => [
  k.name,
  [...effects.values()].filter((e) => e.kind === k.name).toSorted((a, b) => mid(a.hooks.map((h) => hookCol.at.get(h))) - mid(b.hooks.map((h) => hookCol.at.get(h)))),
]);
const effectCol = stack(byKind);
const eventCol = stack([["events", events]]);
const height = Math.max(hookCol.height, effectCol.height, eventCol.height);
const slot = new Map(kinds.map((k) => [k.name, k.slot]));

const describe = (h) => [
  ["matcher", h.matcher === null ? "—" : JSON.stringify(h.matcher)],
  ["fn", h.fn === null ? `${h.file} (inline stub)` : `${h.file}:${h.fn}`],
  ["chunk", `${h.chunk} · ${h.status}`],
  ["catch", h.catch],
  ["reads", h.reads.join(", ") || "—"],
  ["writes", h.writes.join(", ") || "—"],
];
const labelOf = (h) => {
  const match = h.matcher === null ? "" : ` · ${Object.values(h.matcher).flat().map((v) => (typeof v === "object" ? Object.values(v).join() : v === true ? Object.keys(h.matcher)[0] : String(v))).join(", ")}`;
  return h.status === "stub" ? `${h.event} · chunk ${h.chunk}` : `${h.fn}${match}`;
};

// ─── chrome: legend, toggle, tooltip, table ─────────────────────────────────────────────────────────
root.replaceChildren();
const bar = d3.select(root).append("div").attr("class", "chart-bar");
const legend = bar.append("ul").attr("class", "chart-legend").attr("aria-label", "effect kinds");
for (const k of kinds) {
  const li = legend.append("li").attr("title", k.doc);
  li.append("span").attr("class", "chart-swatch").style("background", `var(--kind-${k.slot})`);
  li.append("span").text(k.name);
}
legend.append("li").attr("class", "chart-stub").call((li) => {
  li.append("span").attr("class", "chart-swatch chart-swatch-stub");
  li.append("span").text("stub (planned)");
});
const toggle = bar.append("button").attr("type", "button").attr("class", "chart-toggle").attr("aria-pressed", "false").text("table");
const frame = d3.select(root).append("div").attr("class", "chart-frame");
const tip = d3.select(root).append("div").attr("class", "chart-tip").attr("role", "tooltip").attr("hidden", "");
const table = d3.select(root).append("div").attr("class", "chart-table").attr("hidden", "").append("table");
table.append("thead").append("tr").selectAll("th").data(["hook", "event", "matcher", "file:fn", "chunk", "catch", "reads", "writes", "effects", "does"]).join("th").text((d) => d);
table
  .append("tbody")
  .selectAll("tr")
  .data(hooks)
  .join("tr")
  .selectAll("td")
  .data((h) => [
    h.id,
    h.event,
    describe(h)[0][1],
    describe(h)[1][1],
    describe(h)[2][1],
    h.catch,
    describe(h)[4][1],
    describe(h)[5][1],
    h.effects.map((e) => `${e.kind}: ${e.target}`).join("; ") || "—",
    h.does,
  ])
  .join("td")
  .text((d) => d);
toggle.on("click", () => {
  const isTable = toggle.attr("aria-pressed") !== "true";
  toggle.attr("aria-pressed", String(isTable)).text(isTable ? "graph" : "table");
  frame.attr("hidden", isTable ? "" : null);
  tip.attr("hidden", "");
  d3.select(root).select(".chart-table").attr("hidden", isTable ? null : "");
});

const showTip = (event, title, rows) => {
  tip.selectAll("*").remove();
  tip.append("strong").text(title);
  const dl = tip.append("dl");
  for (const [k, v] of rows) {
    dl.append("dt").text(k);
    dl.append("dd").text(v);
  }
  tip.attr("hidden", null);
  const box = root.getBoundingClientRect();
  const node = event.currentTarget.getBoundingClientRect();
  const tw = tip.node().offsetWidth;
  const left = Math.min(Math.max(0, node.left - box.left), box.width - tw);
  tip.style("left", `${left}px`).style("top", `${node.bottom - box.top + 6}px`);
};

// ─── the graph ─────────────────────────────────────────────────────────────────────────────────────
const draw = () => {
  frame.selectAll("*").remove();
  tip.attr("hidden", "");
  // the frame's content box: its 16px padding on both sides
  const width = Math.max(COLS[0] + COLS[1] + COLS[2] + 160, frame.node().clientWidth - 32);
  const free = (width - COLS[0] - COLS[1] - COLS[2]) / 2;
  const xs = [0, COLS[0] + free, COLS[0] + COLS[1] + 2 * free];
  const svg = frame.append("svg").attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", `hook graph: ${events.length} events, ${hooks.length} hooks, ${effects.size} effect targets`);
  const link = d3.linkHorizontal().x((d) => d[0]).y((d) => d[1]);
  const cy = (y) => y + ROW / 2;
  const links = [
    ...hooks.map((h) => ({ dashed: h.status === "stub", from: events.find((e) => e.name === h.event), hook: h, path: [[xs[0] + COLS[0], cy(eventCol.at.get(events.find((e) => e.name === h.event)))], [xs[1], cy(hookCol.at.get(h))]] })),
    ...[...effects.values()].flatMap((e) => e.hooks.map((h) => ({ dashed: h.status === "stub", effect: e, hook: h, path: [[xs[1] + COLS[1], cy(hookCol.at.get(h))], [xs[2], cy(effectCol.at.get(e))]] }))),
  ];
  const linkSel = svg.append("g").attr("class", "chart-links").selectAll("path").data(links).join("path").attr("d", (d) => link({ source: d.path[0], target: d.path[1] })).classed("is-stub", (d) => d.dashed);

  const heads = svg.append("g").attr("class", "chart-heads");
  for (const [col, x] of [[eventCol, xs[0]], [hookCol, xs[1]], [effectCol, xs[2]]]) {
    heads.selectAll(null).data(col.heads).join("text").attr("x", x).attr("y", (d) => d.y + 13).text((d) => d.label);
  }

  const nodes = (items, x, w, at, cls) =>
    svg.append("g").selectAll("g").data(items).join("g").attr("class", `chart-node ${cls}`).attr("transform", (d) => `translate(${x},${at.get(d)})`).attr("tabindex", 0).call((g) => g.append("rect").attr("width", w).attr("height", ROW).attr("rx", 6));
  const eventSel = nodes(events, xs[0], COLS[0], eventCol.at, "is-event");
  eventSel.append("text").attr("x", 8).attr("y", 16).text((d) => d.name);
  const hookSel = nodes(hooks, xs[1], COLS[1], hookCol.at, "is-hook").classed("is-stub", (d) => d.status === "stub");
  hookSel.append("text").attr("x", 8).attr("y", 16).text(labelOf);
  const effectSel = nodes([...effects.values()], xs[2], COLS[2], effectCol.at, "is-effect");
  effectSel.append("rect").attr("class", "chart-mark").attr("x", 8).attr("y", 8).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", (d) => `var(--kind-${slot.get(d.kind)})`);
  effectSel.append("text").attr("x", 24).attr("y", 16).text((d) => d.target);

  // a lit set of hooks, with the events and effects they touch; `only` narrows the effects to one
  const light = (lit, only) => {
    svg.classed("is-focus", lit !== null);
    if (lit === null) return;
    const reaches = (e) => (only === undefined ? e.hooks.some((h) => lit.has(h)) : e === only);
    linkSel.classed("is-lit", (d) => lit.has(d.hook) && (d.effect === undefined || reaches(d.effect)));
    hookSel.classed("is-lit", (d) => lit.has(d));
    eventSel.classed("is-lit", (d) => d.hooks.some((h) => lit.has(h)));
    effectSel.classed("is-lit", reaches);
  };
  const on = (sel, set, tipOf, only) =>
    sel
      .on("pointerenter focus", (event, d) => {
        light(new Set(set(d)), only?.(d));
        showTip(event, ...tipOf(d));
      })
      .on("pointerleave blur", () => {
        light(null);
        tip.attr("hidden", "");
      });
  on(hookSel, (h) => [h], (h) => [`${h.id} — ${h.does}`, [["event", h.event], ...describe(h)]]);
  on(effectSel, (e) => e.hooks, (e) => [`${e.kind}: ${e.target}`, [["caused by", e.hooks.map((h) => h.id).join(", ")], ["kind", kinds.find((k) => k.name === e.kind).doc]]], (e) => e);
  on(eventSel, (e) => e.hooks, (e) => [`${e.name} — ${e.kind}`, [["doc", e.doc], ["hooks", e.hooks.map((h) => h.id).join(", ")]]]);
};
draw();
let last = root.clientWidth;
new ResizeObserver(() => {
  if (root.clientWidth !== last) {
    last = root.clientWidth;
    draw();
  }
}).observe(root);
