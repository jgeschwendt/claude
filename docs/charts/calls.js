// A day of tool calls in three panels, from docs/data/sample-calls.json (scrubbed by docs/data/scrub.ts; its keys
// gated by scripts/charts.ts): calls per hour stacked by outcome, latency per tool as a dot strip, and the shadow
// judge's routine against destructive for each asked call.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("tool-calls");
const rows = await load("sample-calls.json");

const H = 250;
const PAD = { b: 28, l: 44, r: 16, t: 30 };
const MIN_PANEL = 300;
const KEPT = 10;

const calls = rows.filter((r) => r.kind === "call");
const checks = rows.filter((r) => r.kind === "check");
const OUTCOMES = [
  { color: "var(--ui-ok)", icon: "✓", name: "ok" },
  { color: "var(--ui-danger)", icon: "✕", name: "error" },
  { color: "var(--ui-warn)", icon: "⊘", name: "denied" },
];
const [lo, hi] = d3.extent(calls, (r) => r.hour);
const hours = d3.range(lo, hi + 1).map((hour) => ({ hour, ...Object.fromEntries(OUTCOMES.map(({ name }) => [name, calls.filter((r) => r.hour === hour && r.outcome === name).length])) }));
const clock = (h) => `${String(h).padStart(2, "0")}:00`;

// latency: a row per tool with at least KEPT calls, the rest folded into other, then the shadow judge's own latency
const counted = d3.rollups(calls, (v) => v.length, (r) => r.tool).toSorted((a, b) => b[1] - a[1]);
const kept = new Set(counted.filter(([, n]) => n >= KEPT).map(([t]) => t));
const strips = [
  ...[...kept].map((name) => ({ ms: calls.filter((r) => r.tool === name).map((r) => r.ms), name })),
  { ms: calls.filter((r) => !kept.has(r.tool)).map((r) => r.ms), name: `other (${counted.length - kept.size} tools)` },
  { isJudge: true, ms: checks.map((r) => r.ms), name: "shadow judge" },
].map((s) => ({ ...s, ms: s.ms.toSorted((a, b) => a - b) }));
const ms = (v) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))} s` : `${Math.round(v)} ms`);
const stats = (s) => `n ${s.ms.length} · p50 ${ms(d3.quantileSorted(s.ms, 0.5))} · p90 ${ms(d3.quantileSorted(s.ms, 0.9))} · max ${ms(s.ms.at(-1))}`;

// shadow: one point per distinct (routine, destructive), its calls counted
const points = d3.rollups(checks, (v) => v, (r) => `${r.routine},${r.destructive}`).map(([, v]) => ({ destructive: v[0].destructive, n: v.length, routine: v[0].routine, v }));

const { frame, hide, show } = mount(root, {
  head: ["panel", "row", "value"],
  legend: OUTCOMES.map((o) => ({ color: o.color, icon: o.icon, label: o.name })),
  rows: [
    ...hours.map((h) => ["calls by hour", clock(h.hour), OUTCOMES.map(({ name }) => `${name} ${h[name]}`).join(" · ")]),
    ...strips.map((s) => ["latency", s.name, stats(s)]),
    ...points.toSorted((a, b) => b.n - a.n).map((p) => ["shadow", `routine ${p.routine} · destructive ${p.destructive}`, `${p.n} call${p.n === 1 ? "" : "s"}: ${[...new Set(p.v.map((r) => r.tool))].join(", ")}`]),
  ],
});

const panel = (holder, w, title, note) => {
  const svg = holder.append("svg").attr("width", w).attr("height", H).attr("role", "img").attr("aria-label", title);
  svg.append("text").attr("class", "chart-panel-title").attr("x", 0).attr("y", 14).text(title);
  svg.append("text").attr("class", "chart-panel-note").attr("x", w).attr("y", 14).attr("text-anchor", "end").text(note);
  return svg;
};
const grid = (svg, axis, x, y) => svg.append("g").attr("class", "chart-axis").attr("transform", `translate(${x},${y})`).call(axis).call((g) => g.select(".domain").remove());

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const width = widthOf(frame, MIN_PANEL);
  const across = width >= 3 * MIN_PANEL + 48 ? 3 : 1;
  const w = across === 3 ? (width - 48) / 3 : width;
  const holder = frame.append("div").attr("class", "chart-panels");

  // (a) calls by hour, stacked ok → error → denied with a 2px surface gap, the total on the cap
  {
    const svg = panel(holder, w, "calls by hour", `${calls.length} calls`);
    const x = d3.scaleBand(hours.map((h) => h.hour), [PAD.l, w - PAD.r]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(hours, (h) => d3.sum(OUTCOMES, (o) => h[o.name]))], [H - PAD.b, PAD.t + 8]).nice();
    grid(svg, d3.axisLeft(y).ticks(4).tickSize(-(w - PAD.l - PAD.r)).tickFormat(d3.format(",")), PAD.l, 0);
    grid(svg, d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((h) => `${h}h`), 0, H - PAD.b).classed("is-x", true);
    const bw = Math.min(24, x.bandwidth());
    const segs = hours.flatMap((h) => {
      let base = 0;
      const top = OUTCOMES.findLast((o) => h[o.name] > 0)?.name;
      return OUTCOMES.filter((o) => h[o.name] > 0).map((o) => {
        const seg = { base, h, isTop: o.name === top, n: h[o.name], o };
        base += h[o.name];
        return seg;
      });
    });
    const bar = (s) => {
      const x0 = x(s.h.hour) + (x.bandwidth() - bw) / 2;
      const y0 = y(s.base) - (s.base > 0 ? 1 : 0);
      const y1 = Math.min(y(s.base + s.n) + 1, y0 - 1);
      const r = s.isTop ? Math.min(4, (y0 - y1) / 2) : 0;
      return `M${x0},${y0}V${y1 + r}q0,${-r} ${r},${-r}H${x0 + bw - r}q${r},0 ${r},${r}V${y0}Z`;
    };
    const segSel = svg.append("g").selectAll("path").data(segs).join("path").attr("class", "chart-seg").attr("tabindex", 0).attr("d", bar).style("fill", (s) => s.o.color);
    svg.append("g").selectAll("text").data(hours).join("text").attr("class", "chart-value").attr("x", (h) => x(h.hour) + x.bandwidth() / 2).attr("y", (h) => y(d3.sum(OUTCOMES, (o) => h[o.name])) - 6).attr("text-anchor", "middle").text((h) => d3.sum(OUTCOMES, (o) => h[o.name]));
    hover(segSel, (event, s) => show(event.currentTarget, `${s.n} ${s.o.icon} ${s.o.name}`, [["hour", `${clock(s.h.hour)}–${clock(s.h.hour + 1)}`], ...OUTCOMES.map(({ name }) => [name, String(s.h[name])])]), hide);
  }

  // (b) latency per tool: each call a dot on a log axis, jittered in its row, the median a tick
  {
    const svg = panel(holder, w, "latency per tool", "log scale");
    const left = 118;
    const y = d3.scaleBand(strips.map((s) => s.name), [PAD.t + 4, H - PAD.b]).padding(0.15);
    const x = d3.scaleLog([1, d3.max(strips, (s) => s.ms.at(-1))], [left, w - PAD.r - 14]).nice();
    grid(svg, d3.axisBottom(x).ticks(4, "~s").tickSize(-(H - PAD.b - PAD.t - 4)).tickFormat((v) => ms(v)), 0, H - PAD.b).classed("is-x", true);
    const rowSel = svg.append("g").selectAll("g").data(strips).join("g").attr("class", "chart-strip").attr("tabindex", 0).attr("transform", (s) => `translate(0,${y(s.name)})`);
    rowSel.append("rect").attr("class", "chart-hit").attr("x", 0).attr("width", w).attr("height", y.bandwidth());
    rowSel.append("text").attr("class", "chart-tick-label").classed("is-dim", (s) => s.isJudge).attr("x", left - 8).attr("y", y.bandwidth() / 2 + 4).attr("text-anchor", "end").text((s) => s.name);
    const jitter = d3.randomLcg(7);
    rowSel
      .selectAll("circle")
      .data((s) => s.ms.map((v) => ({ isJudge: s.isJudge, v })))
      .join("circle")
      .attr("class", "chart-dot")
      .attr("cx", (d) => x(Math.max(1, d.v)))
      .attr("cy", () => y.bandwidth() / 2 + (jitter() - 0.5) * (y.bandwidth() - 8))
      .attr("r", 2.5)
      .classed("is-judge", (d) => d.isJudge);
    rowSel.append("line").attr("class", "chart-median").attr("x1", (s) => x(Math.max(1, d3.quantileSorted(s.ms, 0.5)))).attr("x2", (s) => x(Math.max(1, d3.quantileSorted(s.ms, 0.5)))).attr("y1", 1).attr("y2", y.bandwidth() - 1);
    hover(rowSel, (event, s) => show(event.currentTarget.querySelector("text"), s.name, [["calls", String(s.ms.length)], ["p50", ms(d3.quantileSorted(s.ms, 0.5))], ["p90", ms(d3.quantileSorted(s.ms, 0.9))], ["max", ms(s.ms.at(-1))]]), hide);
  }

  // (c) the shadow: routine against destructive, nearest point under the pointer
  {
    const svg = panel(holder, w, "shadow: routine × destructive", `${checks.length} asked calls`);
    const x = d3.scaleLinear([0, 1], [PAD.l, w - PAD.r]);
    const y = d3.scaleLinear([0, 1], [H - PAD.b - 12, PAD.t + 8]);
    grid(svg, d3.axisLeft(y).ticks(4).tickSize(-(w - PAD.l - PAD.r)), PAD.l, 0);
    grid(svg, d3.axisBottom(x).ticks(4).tickSize(-(H - PAD.b - 12 - PAD.t - 8)), 0, H - PAD.b - 12).classed("is-x", true);
    svg.append("text").attr("class", "chart-axis-title").attr("x", w - PAD.r).attr("y", H - 2).attr("text-anchor", "end").text("routine →");
    svg.append("text").attr("class", "chart-axis-title").attr("x", PAD.l - 36).attr("y", PAD.t - 2).text("↑ destructive");
    const r = d3.scaleSqrt([1, d3.max(points, (p) => p.n)], [4, 9]);
    const dots = svg.append("g").selectAll("circle").data(points.toSorted((a, b) => b.n - a.n)).join("circle").attr("class", "chart-dot is-ringed").attr("cx", (p) => x(p.routine)).attr("cy", (p) => y(p.destructive)).attr("r", (p) => r(p.n));
    const delaunay = d3.Delaunay.from(points, (p) => x(p.routine), (p) => y(p.destructive));
    svg
      .append("rect")
      .attr("class", "chart-hit")
      .attr("x", PAD.l)
      .attr("y", PAD.t)
      .attr("width", w - PAD.l - PAD.r)
      .attr("height", H - PAD.b - PAD.t)
      .on("pointermove", (event) => {
        const [px, py] = d3.pointer(event);
        const p = points[delaunay.find(px, py)];
        dots.classed("is-lit", (d) => d === p);
        const box = svg.node().getBoundingClientRect();
        show({ bottom: box.top + y(p.destructive) + r(p.n), left: box.left + x(p.routine) }, `routine ${p.routine} · destructive ${p.destructive}`, [
          ["calls", String(p.n)],
          ["tools", [...new Set(p.v.map((c) => c.tool))].join(", ")],
          ["outbound", [...new Set(p.v.map((c) => c.outbound))].join(", ")],
          ["secrets", [...new Set(p.v.map((c) => c.secrets))].join(", ")],
          ["judge ms", p.v.map((c) => c.ms).join(", ")],
        ]);
      })
      .on("pointerleave", () => {
        dots.classed("is-lit", false);
        hide();
      });
  }
};
redraw(root, draw);
