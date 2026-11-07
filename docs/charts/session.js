// The life of a session: every moment of one invented session in four lanes — the engine's event, the subether hook it
// reaches with its writes, the System One judgment, and the trail event it leaves. Moments keep their order; a crowded
// stretch is spread so no two marks touch, and the time axis follows the spread. scripts/charts.ts holds each moment's
// hook, effects, markers and trails to hooks.json, markers.ts, check.ts and judge.json's THRESHOLD.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("session-life");
const [data, hooks, judge] = await Promise.all([load("session.json"), load("hooks.json"), load("judge.json")]);

const LEFT = 56;
const ROW = 56;
const LANE = 44;
const TOP = 58;
const CHIP = 18;
const BAR = { gap: 3, h: 28, w: 6 };
const GAP = { group: 12, lane: 8, moment: 6 };
const CUT = 30;
const MIN = 900;

const THRESHOLD = judge.constants["markers.ts"].THRESHOLD;
const slot = new Map(hooks.kinds.map((k, i) => [k.name, i + 1]));
const hookOf = new Map(hooks.hooks.map((h) => [h.id, h]));
const kindOf = (m, target) => hookOf.get(m.hook).effects.find((e) => e.target === target).kind;
const laneY = new Map(data.lanes.map((l, i) => [l.name, TOP + i * ROW]));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
// a rationale shown as its head, cut, and its p; the judge's name is the judge lane's, the whole in the tooltip
const cut = (text) => {
  const { head = text, p } = /^(?<head>.*) \(p=(?<p>[\d.]+), \w+\)$/u.exec(text)?.groups ?? {};
  const tail = p === undefined ? "" : ` (p=${p})`;
  const room = CUT - tail.length;
  return `${head.length > room ? `${head.slice(0, room - 1)}…` : head}${tail}`;
};
const fnOf = (m) => (m.status === "stub" ? "docket (planned)" : m.hook.slice(m.hook.indexOf(".") + 1));
const over = (m) => Object.entries(m.judge?.markers ?? {}).filter(([, p]) => p >= THRESHOLD);
const noteOf = (m) => (m.hook === "check.check" ? "a check line" : `no event · under ${THRESHOLD}`);
const moments = data.moments.map((m, i) => ({ ...m, i, trails: m.trails ?? [] }));
const trails = moments.flatMap((m) => m.trails.map((t, k) => ({ ...t, k, m })));
const groups = d3.groups(moments, (m) => `${m.at}·${m.event}`).map(([, ms]) => ({ at: ms[0].at, event: ms[0].event, labels: [...new Set(ms.map((m) => m.label))].join(" · "), ms }));
const kinds = [...new Set(moments.flatMap((m) => m.effects.map((e) => kindOf(m, e.target))))].toSorted((a, b) => slot.get(a) - slot.get(b));
const judgeCell = (m) => (m.judge ? `${m.judge.by} · ${Object.entries(m.judge.markers).map(([k, p]) => `${k} ${p}`).join(", ")}` : m.probe ? `probe · ${Object.entries(m.probe).map(([k, v]) => `${k} ${v}`).join(", ")}` : "—");

const { frame, hide, show } = mount(root, {
  head: ["at", "event", "hook", "judge", "trail", "writes"],
  legend: [
    { color: "var(--ui-fg-muted)", label: "event", mark: "dot" },
    { color: "var(--ui-fg-faint)", label: "hook" },
    { color: "var(--ui-accent)", label: `marker ≥ ${THRESHOLD}` },
    { color: "var(--ui-danger)", label: "trail · guard", mark: "dot" },
    { color: "var(--ui-accent)", label: "trail · correction", mark: "dot" },
    { label: "planned", mark: "stub" },
    ...kinds.map((k) => ({ color: `var(--kind-${slot.get(k)})`, label: `write · ${k}` })),
  ],
  rows: moments.map((m) => [mmss(m.at), m.event, m.hook, judgeCell(m), m.trails.map((t) => t.rationale).join(" · ") || "—", m.effects.map((e) => e.target).join(", ") || "—"]),
});

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const svg = frame.append("svg").attr("class", "chart-life").attr("role", "img").attr("aria-label", `the life of a session: ${moments.length} moments, ${trails.length} trail events`);
  const measure = (cls, text) => {
    const node = svg.append("text").attr("class", cls).text(text);
    const w = node.node().getComputedTextLength();
    node.remove();
    return w;
  };

  // each moment's footprint per lane, from its spine: the chip and its badges, the judge group or probe chip and the
  // notes under it, each trail's diamond and rationale; a group's event label centred over its spines
  const foot = new Map(moments.map((m) => {
    const chip = measure("chart-life-chip", fnOf(m)) + 10;
    const badges = m.effects.length * 10;
    const judged = m.judge ? Math.max(4 * (BAR.w + BAR.gap), 8 + measure("chart-halo is-small", m.trails.length > 0 ? m.judge.by : noteOf(m))) : 0;
    const probe = m.probe ? measure("chart-halo is-small", "probe · typesafe up") + 26 : 0;
    const trail = Math.max(0, ...m.trails.map((t) => 14 + measure("chart-halo is-small", cut(t.rationale))));
    return [m, { chip, hook: chip + (badges && badges + 4), judge: Math.max(judged, probe), trail }];
  }));
  const eventW = new Map(groups.map((g) => [g, Math.max(measure("chart-life-event", g.event), measure("chart-halo is-small", g.labels)) + 4]));
  const place = (base) => {
    const right = { event: -Infinity, hook: -Infinity, judge: -Infinity, trail: -Infinity };
    const ps = groups.map((g) => {
      const offs = g.ms.reduce((xs, m, i) => [...xs, i === 0 ? 0 : xs[i - 1] + foot.get(g.ms[i - 1]).hook + GAP.moment], []);
      const mid = (offs[0] + offs.at(-1)) / 2;
      const lefts = { event: 6 + mid - eventW.get(g) / 2, hook: 0, judge: Math.min(...offs.filter((o, i) => foot.get(g.ms[i]).judge > 0)), trail: Math.min(...offs.filter((o, i) => foot.get(g.ms[i]).trail > 0)) };
      const x = Math.max(base(g.at), ...Object.keys(right).map((k) => right[k] + GAP.lane - lefts[k]));
      right.event = x + 6 + mid + eventW.get(g) / 2;
      g.ms.forEach((m, i) => {
        right.hook = x + offs[i] + foot.get(m).hook + GAP.group - GAP.lane;
        right.judge = foot.get(m).judge > 0 ? x + offs[i] + foot.get(m).judge : right.judge;
        right.trail = foot.get(m).trail > 0 ? x + offs[i] + foot.get(m).trail : right.trail;
      });
      return { cx: x + 6 + mid, g, spines: offs.map((o) => x + o) };
    });
    return { edge: Math.max(...Object.values(right)), ps };
  };
  const end = moments.at(-1).at;
  // packed tight first: its edge sets the least width, and how far the last group reaches past its own start
  const packed = place(() => LEFT);
  const width = Math.max(widthOf(frame, MIN), packed.edge + 16);
  const { edge, ps: placed } = place(d3.scaleLinear([0, end], [LEFT, width - 16 - (packed.edge - packed.ps.at(-1).spines[0])]));
  const spine = new Map(placed.flatMap((p) => p.g.ms.map((m, i) => [m, p.spines[i] + 6])));
  const ats = d3.groups(placed, (p) => p.g.at).map(([at, ps]) => [at, ps[0].cx]);
  const time = d3.scaleLinear(ats.map(([at]) => at), ats.map(([, x]) => x));
  const axisY = laneY.get("trail") + 46;
  const height = axisY + 28;
  const full = Math.max(width, edge + 16);
  svg.attr("width", full).attr("height", height);

  // lanes: a faint band and its name; the trail's stronger
  const lanes = svg.append("g");
  for (const lane of data.lanes) {
    lanes.append("rect").attr("class", "chart-lane").classed("is-trail", lane.name === "trail").attr("x", LEFT - 12).attr("y", laneY.get(lane.name) - LANE / 2).attr("width", full - LEFT + 12).attr("height", LANE).attr("rx", 6);
  }
  lanes.append("g").attr("class", "chart-heads").selectAll("text").data(data.lanes).join("text").attr("x", 0).attr("y", (l) => laneY.get(l.name) + 4).text((l) => l.name).append("title").text((l) => l.doc);
  svg.append("g").attr("class", "chart-axis").attr("transform", `translate(0,${axisY})`).call(d3.axisBottom(time).tickValues(d3.range(0, end + 1, 60)).tickFormat((s) => (s === 0 ? "0 s" : `${s / 60} min`)).tickSizeOuter(0));

  const [yE, yH, yJ, yT] = ["event", "hook", "judge", "trail"].map((n) => laneY.get(n));
  const base = yJ + 12;
  const trailY = (t) => yT + t.k * 18;
  // connectors: event → hook (a bracket for a shared dot), hook → judge, judge or hook → trail
  const links = [
    ...placed.flatMap(({ cx, g }) => g.ms.map((m) => ({ d: g.ms.length > 1 ? `M${cx},${yE + 5}V${yH - 22}H${spine.get(m)}V${yH - CHIP / 2}` : `M${cx},${yE + 5}V${yH - CHIP / 2}`, m }))),
    ...moments.filter((m) => m.judge || m.probe).map((m) => ({ d: `M${spine.get(m)},${yH + CHIP / 2}V${m.judge ? base - BAR.h - 2 : yJ - 9}`, m })),
    ...trails.map((t) => ({ d: `M${spine.get(t.m)},${t.m.judge ? base : yH + CHIP / 2}V${trailY(t) - 7}`, m: t.m })),
  ];
  const linkSel = svg.append("g").attr("class", "chart-life-links").selectAll("path").data(links).join("path").attr("d", (l) => l.d);

  // event: one dot per (at, event), the event name and the moments' labels above it
  const eventSel = svg.append("g").selectAll("g").data(placed).join("g").attr("class", "chart-life-item chart-life-dot").classed("is-stub", (p) => p.g.ms.every((m) => m.status === "stub")).attr("tabindex", 0).attr("transform", (p) => `translate(${p.cx},${yE})`);
  eventSel.append("circle").attr("r", 5);
  eventSel.append("text").attr("class", "chart-life-event").attr("y", -12).attr("text-anchor", "middle").text((p) => p.g.event);
  eventSel.append("text").attr("class", "chart-halo is-small").attr("y", -26).attr("text-anchor", "middle").text((p) => p.g.labels);

  // hook: a chip with the function's name, a write badge per effect in its kind's hue
  const chipSel = svg.append("g").selectAll("g").data(moments).join("g").attr("class", "chart-node chart-life-item").classed("is-stub", (m) => m.status === "stub").attr("tabindex", 0).attr("transform", (m) => `translate(${spine.get(m) - 6},${yH - CHIP / 2})`);
  chipSel.append("rect").attr("width", (m) => foot.get(m).chip).attr("height", CHIP).attr("rx", 5);
  chipSel.append("text").attr("class", "chart-life-chip").attr("x", 5).attr("y", 13).text(fnOf);
  chipSel.selectAll(".chart-badge").data((m) => m.effects.map((e, i) => ({ e, i, m }))).join("rect").attr("class", "chart-badge").attr("x", (b) => foot.get(b.m).chip + 4 + b.i * 10).attr("y", 5).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", (b) => `var(--kind-${slot.get(kindOf(b.m, b.e.target))})`);

  // judge: four bars to scale, the threshold across them; the judge's name, or why nothing trailed, beneath
  const judgeSel = svg.append("g").selectAll("g").data(moments.filter((m) => m.judge)).join("g").attr("class", "chart-life-item chart-life-judge").attr("tabindex", 0).attr("transform", (m) => `translate(${spine.get(m) - BAR.w / 2},0)`);
  const span = 4 * BAR.w + 3 * BAR.gap;
  judgeSel.append("rect").attr("class", "chart-hit").attr("x", -4).attr("y", base - BAR.h - 4).attr("width", span + 8).attr("height", BAR.h + 8);
  judgeSel.selectAll(".chart-life-bar").data((m) => Object.entries(m.judge.markers).map(([name, p], i) => ({ i, name, p }))).join("rect").attr("class", "chart-life-bar").classed("is-over", (b) => b.p >= THRESHOLD).attr("x", (b) => b.i * (BAR.w + BAR.gap)).attr("y", (b) => base - Math.max(1, b.p * BAR.h)).attr("width", BAR.w).attr("height", (b) => Math.max(1, b.p * BAR.h));
  judgeSel.append("line").attr("class", "chart-threshold").attr("x1", -3).attr("x2", span + 3).attr("y1", base - THRESHOLD * BAR.h).attr("y2", base - THRESHOLD * BAR.h);
  judgeSel.append("text").attr("class", "chart-halo is-small").attr("x", BAR.w + 6).attr("y", base + 13).text((m) => m.judge.by);
  judgeSel.filter((m) => m.trails.length === 0).append("text").attr("class", "chart-panel-note").attr("x", BAR.w + 6).attr("y", base + 26).text(noteOf);
  const probeSel = svg.append("g").selectAll("g").data(moments.filter((m) => m.probe)).join("g").attr("class", "chart-node chart-life-item").attr("tabindex", 0).attr("transform", (m) => `translate(${spine.get(m) - 6},${yJ - 9})`);
  probeSel.append("rect").attr("width", (m) => foot.get(m).judge - 4).attr("height", CHIP).attr("rx", CHIP / 2);
  probeSel.append("text").attr("class", "chart-life-ok").attr("x", 7).attr("y", 13).text("✓");
  probeSel.append("text").attr("class", "chart-halo is-small").attr("x", 20).attr("y", 13).text((m) => `probe · typesafe ${m.probe.typesafe}`);

  // trail: a diamond in its kind's colour, the rationale cut beside it
  const trailSel = svg.append("g").selectAll("g").data(trails).join("g").attr("class", "chart-life-item chart-life-trail").attr("tabindex", 0).attr("transform", (t) => `translate(${spine.get(t.m)},${trailY(t)})`);
  trailSel.append("rect").attr("class", (t) => `chart-life-diamond is-${t.kind}`).attr("x", -5).attr("y", -5).attr("width", 10).attr("height", 10).attr("transform", "rotate(45)");
  trailSel.append("text").attr("class", "chart-halo is-small").attr("x", 11).attr("y", 4).text((t) => cut(t.rationale));

  const off = () => {
    svg.classed("is-focus", false);
    hide();
  };
  const lit = (ms) => {
    svg.classed("is-focus", true);
    eventSel.classed("is-lit", (p) => p.g.ms.some((m) => ms.includes(m)));
    for (const sel of [chipSel, judgeSel, probeSel]) sel.classed("is-lit", (m) => ms.includes(m));
    trailSel.classed("is-lit", (t) => ms.includes(t.m));
    linkSel.classed("is-lit", (l) => ms.includes(l.m));
  };
  hover(eventSel, (event, p) => {
    lit(p.g.ms);
    show(event.currentTarget, `${p.g.event} · ${mmss(p.g.at)}`, p.g.ms.map((m) => [m.label, m.hook]));
  }, off);
  hover(chipSel, (event, m) => {
    lit([m]);
    show(event.currentTarget, `${m.label} · ${m.hook}`, [["event", m.event], ["at", mmss(m.at)], ["is", m.doc], ...m.effects.map((e) => ["writes", `${e.target} (${kindOf(m, e.target)})`]), ...(m.tool ? [["tool", m.tool]] : [])]);
  }, off);
  hover(judgeSel, (event, m) => {
    lit([m]);
    show(event.currentTarget, `${m.label} · judged by ${m.judge.by}`, [...Object.entries(m.judge.markers).map(([k, p]) => [k, `${p}${m.trails.length > 0 && p >= THRESHOLD ? " → trail" : ""}`]), ["threshold", `${THRESHOLD} (markers.ts)`], ...(over(m).length > 0 && m.trails.length === 0 ? [["writes", noteOf(m)]] : [])]);
  }, off);
  hover(probeSel, (event, m) => {
    lit([m]);
    show(event.currentTarget, `${m.label} · probe`, Object.entries(m.probe));
  }, off);
  hover(trailSel, (event, t) => {
    lit([t.m]);
    show(event.currentTarget, `${t.m.label} · trail · ${t.kind}`, [["rationale", t.rationale], ["from", t.m.hook], ["at", mmss(t.m.at)]]);
  }, off);
};
redraw(root, draw);
