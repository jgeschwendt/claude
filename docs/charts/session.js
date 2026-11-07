// The life of a session: every moment of one invented session as a row, time running down, in four columns — the
// engine's event, the subether hook it reaches with its writes, the System One judgment, and the trail event it leaves.
// Rows keep their order; a crowded stretch is spread so no two rows touch, and the time axis follows the spread. scripts/charts.ts holds each moment's
// hook, effects, markers and trails to hooks.json, markers.ts, check.ts and judge.json's THRESHOLD.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("session-life");
const [data, hooks, judge] = await Promise.all([load("session.json"), load("hooks.json"), load("judge.json")]);

const AXIS = 46;
const TOP = 44;
const PITCH = 34;
const SPAN = 620;
const CHIP = 18;
const BAR = { gap: 3, h: 24, w: 6 };
const GAP = 12;
const CUT = 48;
const MIN = 640;
const COLS = { event: 0.22, hook: 0.26, judge: 0.2, trail: 0.32 };

const THRESHOLD = judge.constants["markers.ts"].THRESHOLD;
const slot = new Map(hooks.kinds.map((k, i) => [k.name, i + 1]));
const hookOf = new Map(hooks.hooks.map((h) => [h.id, h]));
const kindOf = (m, target) => hookOf.get(m.hook).effects.find((e) => e.target === target).kind;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
// a rationale shown as its head, cut to `room` characters, and its p; the judge's name is the judge column's
const cut = (text, room = CUT) => {
  const { head = text, p } = /^(?<head>.*) \(p=(?<p>[\d.]+), \w+\)$/u.exec(text)?.groups ?? {};
  const tail = p === undefined ? "" : ` (p=${p})`;
  const left = room - tail.length;
  return `${head.length > left ? `${head.slice(0, left - 1)}…` : head}${tail}`;
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
  const width = widthOf(frame, MIN);
  const names = Object.keys(COLS);
  const colX = Object.fromEntries(names.map((n, i) => [n, AXIS + 8 + (width - AXIS - 8) * d3.sum(names.slice(0, i), (k) => COLS[k])]));
  const span = 4 * BAR.w + 3 * BAR.gap;
  const dotX = colX.event + 6;

  // each row left to right: the event's text after its dot, the hook chips in a row, the judge group beside them, the
  // trail after; a column's marks start at its edge, or past the row's marks before them when those run long
  const rows = groups.map((g) => {
    const textEnd = dotX + 10 + measure("chart-life-event", g.event) + 8 + measure("chart-halo is-small", g.labels);
    const chips = g.ms.reduce((xs, m, i) => {
      const x = i === 0 ? Math.max(colX.hook, textEnd + GAP) : xs[i - 1].end + 8;
      const w = measure("chart-life-chip", fnOf(m)) + 10;
      return [...xs, { end: x + w + (m.effects.length > 0 ? 4 + m.effects.length * 10 : 0), m, w, x }];
    }, []);
    const jm = g.ms.find((m) => m.judge || m.probe);
    const jx = Math.max(colX.judge, chips.at(-1).end + GAP);
    const jEnd = jm === undefined ? jx : jm.judge ? jx + span + 6 + measure("chart-halo is-small", jm.judge.by) : jx + measure("chart-halo is-small", "probe · typesafe up") + 26;
    const tm = g.ms.find((m) => m.trails.length > 0);
    const tx = Math.max(colX.trail, jEnd + GAP) + 6;
    const fit = (t) => {
      const room = width - tx - 14;
      const lengths = d3.range(CUT, 11, -1);
      return cut(t.rationale, lengths.find((n) => measure("chart-halo is-small", cut(t.rationale, n)) <= room) ?? 12);
    };
    const below = Math.max(12, jm?.judge && tm === undefined ? 28 : 0, tm ? (tm.trails.length - 1) * 18 + 8 : 0);
    return { below, chips, g, jEnd, jm, jx, textEnd, tm, tx, fit };
  });
  const place = (base) => rows.reduce((ys, r, i) => [...ys, Math.max(base(r.g.at), i === 0 ? TOP : ys[i - 1] + Math.max(PITCH, rows[i - 1].below + 20))], []);
  const end = moments.at(-1).at;
  const packed = place(() => TOP);
  const ys = place(d3.scaleLinear([0, end], [TOP, TOP + Math.max(SPAN, packed.at(-1) - TOP)]));
  const height = ys.at(-1) + rows.at(-1).below + 20;
  const right = Math.max(width, ...rows.map((r) => r.jEnd + 16));
  svg.attr("width", right).attr("height", height);
  const ats = d3.groups(rows.map((r, i) => [r.g.at, ys[i]]), ([at]) => at).map(([at, rs]) => [at, rs[0][1]]);
  const time = d3.scaleLinear(ats.map(([at]) => at), ats.map(([, y]) => y));
  const placed = rows.map((r, i) => ({ ...r, y: ys[i] }));
  const rowOf = new Map(placed.flatMap((r) => r.g.ms.map((m) => [m, r])));
  const chipOf = new Map(placed.flatMap((r) => r.chips.map((c) => [c.m, c])));

  // columns: a faint band and its name across the top, the trail's stronger; the time axis down the left edge
  const cols = svg.append("g");
  cols.selectAll("rect").data(data.lanes).join("rect").attr("class", "chart-lane").classed("is-trail", (l) => l.name === "trail").attr("x", (l) => colX[l.name] - 6).attr("y", TOP - 22).attr("width", (l, i) => (i + 1 < names.length ? colX[names[i + 1]] : right) - colX[l.name] - 2).attr("height", height - TOP + 14).attr("rx", 6);
  cols.append("g").attr("class", "chart-heads").selectAll("text").data(data.lanes).join("text").attr("x", (l) => colX[l.name]).attr("y", 12).text((l) => l.name).append("title").text((l) => l.doc);
  svg.append("g").attr("class", "chart-axis").attr("transform", `translate(${AXIS},0)`).call(d3.axisLeft(time).tickValues(d3.range(0, end + 1, 60)).tickFormat((s) => (s === 0 ? "0 s" : `${s / 60} min`)).tickSizeOuter(0));
  svg.append("line").attr("class", "chart-life-spine").attr("x1", dotX).attr("x2", dotX).attr("y1", ys[0]).attr("y2", ys.at(-1));

  // connectors: event text → first chip, chip → judge, judge or chip → trail; one from a chip with chips after it
  // runs under them
  const from = (m, r) => {
    const c = chipOf.get(m);
    return c === r.chips.at(-1) ? `M${c.end + 2},${r.y}` : `M${c.x + c.w / 2},${r.y + CHIP / 2}V${r.y + CHIP / 2 + 5}H${r.chips.at(-1).end + 6}V${r.y}`;
  };
  const links = [
    ...placed.map((r) => ({ d: `M${r.textEnd + 4},${r.y}H${r.chips[0].x - 2}`, ms: r.g.ms })),
    ...placed.filter((r) => r.jm).map((r) => ({ d: `${from(r.jm, r)}H${r.jx - 4}`, ms: [r.jm] })),
    ...trails.map((t) => {
      const r = rowOf.get(t.m);
      const start = t.m.judge ? `M${r.jEnd + 4},${r.y}` : from(t.m, r);
      return { d: t.k === 0 ? `${start}H${r.tx - 8}` : `M${r.tx - 14},${r.y}V${r.y + t.k * 18}H${r.tx - 8}`, ms: [t.m] };
    }),
  ];
  const linkSel = svg.append("g").attr("class", "chart-life-links").selectAll("path").data(links).join("path").attr("d", (l) => l.d);

  // event: one dot per (at, event) on the spine, the event name and the moments' labels after it
  const eventSel = svg.append("g").selectAll("g").data(placed).join("g").attr("class", "chart-life-item chart-life-dot").classed("is-stub", (r) => r.g.ms.every((m) => m.status === "stub")).attr("tabindex", 0).attr("transform", (r) => `translate(${dotX},${r.y})`);
  eventSel.append("circle").attr("r", 5);
  const label = eventSel.append("text").attr("x", 10).attr("y", 4);
  label.append("tspan").attr("class", "chart-life-event").text((r) => r.g.event);
  label.append("tspan").attr("class", "chart-life-label").attr("dx", 8).text((r) => r.g.labels);

  // hook: a chip with the function's name, a write badge per effect in its kind's hue
  const chipSel = svg.append("g").selectAll("g").data(moments).join("g").attr("class", "chart-node chart-life-item").classed("is-stub", (m) => m.status === "stub").attr("tabindex", 0).attr("transform", (m) => `translate(${chipOf.get(m).x},${rowOf.get(m).y - CHIP / 2})`);
  chipSel.append("rect").attr("width", (m) => chipOf.get(m).w).attr("height", CHIP).attr("rx", 5);
  chipSel.append("text").attr("class", "chart-life-chip").attr("x", 5).attr("y", 13).text(fnOf);
  chipSel.selectAll(".chart-badge").data((m) => m.effects.map((e, i) => ({ e, i, m }))).join("rect").attr("class", "chart-badge").attr("x", (b) => chipOf.get(b.m).w + 4 + b.i * 10).attr("y", 5).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", (b) => `var(--kind-${slot.get(kindOf(b.m, b.e.target))})`);

  // judge: four bars to scale, the threshold across them, the judge's name after; why nothing trailed beneath
  const judgeSel = svg.append("g").selectAll("g").data(moments.filter((m) => m.judge)).join("g").attr("class", "chart-life-item chart-life-judge").attr("tabindex", 0).attr("transform", (m) => `translate(${rowOf.get(m).jx},${rowOf.get(m).y + 10})`);
  judgeSel.append("rect").attr("class", "chart-hit").attr("x", -4).attr("y", -BAR.h - 4).attr("width", span + 8).attr("height", BAR.h + 8);
  judgeSel.selectAll(".chart-life-bar").data((m) => Object.entries(m.judge.markers).map(([name, p], i) => ({ i, name, p }))).join("rect").attr("class", "chart-life-bar").classed("is-over", (b) => b.p >= THRESHOLD).attr("x", (b) => b.i * (BAR.w + BAR.gap)).attr("y", (b) => -Math.max(1, b.p * BAR.h)).attr("width", BAR.w).attr("height", (b) => Math.max(1, b.p * BAR.h));
  judgeSel.append("line").attr("class", "chart-threshold").attr("x1", -3).attr("x2", span + 3).attr("y1", -THRESHOLD * BAR.h).attr("y2", -THRESHOLD * BAR.h);
  judgeSel.append("text").attr("class", "chart-halo is-small").attr("x", span + 6).attr("y", -6).text((m) => m.judge.by);
  judgeSel.filter((m) => m.trails.length === 0).append("text").attr("class", "chart-panel-note").attr("x", 0).attr("y", 14).text(noteOf);
  const probeSel = svg.append("g").selectAll("g").data(moments.filter((m) => m.probe)).join("g").attr("class", "chart-node chart-life-item").attr("tabindex", 0).attr("transform", (m) => `translate(${rowOf.get(m).jx},${rowOf.get(m).y - CHIP / 2})`);
  probeSel.append("rect").attr("width", (m) => rowOf.get(m).jEnd - rowOf.get(m).jx - 4).attr("height", CHIP).attr("rx", CHIP / 2);
  probeSel.append("text").attr("class", "chart-life-ok").attr("x", 7).attr("y", 13).text("✓");
  probeSel.append("text").attr("class", "chart-halo is-small").attr("x", 20).attr("y", 13).text((m) => `probe · typesafe ${m.probe.typesafe}`);

  // trail: a diamond in its kind's colour, the rationale cut to the column after it, consecutive rows for two
  const trailSel = svg.append("g").selectAll("g").data(trails).join("g").attr("class", "chart-life-item chart-life-trail").attr("tabindex", 0).attr("transform", (t) => `translate(${rowOf.get(t.m).tx},${rowOf.get(t.m).y + t.k * 18})`);
  trailSel.append("rect").attr("class", (t) => `chart-life-diamond is-${t.kind}`).attr("x", -5).attr("y", -5).attr("width", 10).attr("height", 10).attr("transform", "rotate(45)");
  trailSel.append("text").attr("class", "chart-halo is-small").attr("x", 11).attr("y", 4).text((t) => rowOf.get(t.m).fit(t));

  const off = () => {
    svg.classed("is-focus", false);
    hide();
  };
  const lit = (ms) => {
    svg.classed("is-focus", true);
    eventSel.classed("is-lit", (r) => r.g.ms.some((m) => ms.includes(m)));
    for (const sel of [chipSel, judgeSel, probeSel]) sel.classed("is-lit", (m) => ms.includes(m));
    trailSel.classed("is-lit", (t) => ms.includes(t.m));
    linkSel.classed("is-lit", (l) => l.ms.some((m) => ms.includes(m)));
  };
  hover(eventSel, (event, r) => {
    lit(r.g.ms);
    show(event.currentTarget, `${r.g.event} · ${mmss(r.g.at)}`, r.g.ms.map((m) => [m.label, m.hook]));
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
