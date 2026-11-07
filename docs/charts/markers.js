// The markers over the trail: each correction event of the month a dot in its day, placed by hour; its height the
// judge's yes-probability above the trail threshold (judge.json's, gated against markers.ts), the retired regex era's
// unscored events hollow in a lane beneath. From docs/data/sample-markers.json, scrubbed by docs/data/scrub.ts.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("trail-markers");
const [events, judge] = await Promise.all([load("sample-markers.json"), load("judge.json")]);

const H = 230;
const LANE = 34;
const PAD = { b: 26, l: 44, r: 16, t: 14 };
const MIN = 520;

const THRESHOLD = judge.constants["markers.ts"].THRESHOLD;
const MARKERS = [
  { color: "var(--kind-1)", name: "correction" },
  { color: "var(--kind-2)", name: "repeated instruction" },
  { color: "var(--kind-6)", name: "preference" },
  { color: "var(--kind-7)", name: "approval" },
];
const colorOf = new Map(MARKERS.map((m) => [m.name, m.color]));
const days = [...new Set(events.map((e) => e.day))].toSorted();
const dated = events.map((e, i) => ({ ...e, i }));

const { frame, hide, show } = mount(root, {
  head: ["day", "hour", "marker", "p", "judge"],
  legend: [...MARKERS.map((m) => ({ color: m.color, label: m.name, mark: "dot" })), { color: "var(--ui-fg-faint)", label: "regex era (no p)", mark: "ring" }],
  rows: dated.map((e) => [e.day, `${e.hour}h`, e.marker, e.p ?? "—", e.judge ?? "—"]),
});

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const width = widthOf(frame, MIN);
  const svg = frame.append("svg").attr("width", width).attr("height", H).attr("role", "img").attr("aria-label", `${events.length} correction events over ${days.length} days`);
  const x = d3.scaleBand(days, [PAD.l, width - PAD.r]).paddingInner(0.08);
  const at = (e) => x(e.day) + (x.bandwidth() * (e.hour + 0.5)) / 24;
  const base = H - PAD.b - LANE;
  const y = d3.scaleLinear([Math.min(THRESHOLD - 0.1, d3.min(events, (e) => e.p ?? 1)), 1], [base - 10, PAD.t]);

  svg.append("g").selectAll("rect").data(days).join("rect").attr("class", "chart-dayband").attr("x", (d) => x(d)).attr("y", PAD.t - 6).attr("width", x.bandwidth()).attr("height", H - PAD.b - PAD.t + 6).attr("rx", 4);
  svg.append("g").attr("class", "chart-axis").attr("transform", `translate(${PAD.l},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width - PAD.l - PAD.r))).call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "chart-axis is-x").attr("transform", `translate(0,${H - PAD.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((d) => d.slice(5))).call((g) => g.select(".domain").remove());
  svg.append("line").attr("class", "chart-threshold").attr("x1", PAD.l).attr("x2", width - PAD.r).attr("y1", y(THRESHOLD)).attr("y2", y(THRESHOLD));
  svg.append("text").attr("class", "chart-halo is-small").attr("x", width - PAD.r - 4).attr("y", y(THRESHOLD) - 5).attr("text-anchor", "end").text(`trailed at ${THRESHOLD}`);
  svg.append("text").attr("class", "chart-panel-note").attr("x", PAD.l - 6).attr("y", base + LANE / 2 + 4).attr("text-anchor", "end").text("no p");

  // events sharing a day and hour fan out sideways
  const fan = d3.rollup(dated, (v) => v.map((e) => e.i), (e) => `${e.day} ${e.hour} ${e.p === null}`);
  const nudge = (e) => {
    const peers = fan.get(`${e.day} ${e.hour} ${e.p === null}`);
    return (peers.indexOf(e.i) - (peers.length - 1) / 2) * 11;
  };
  const dots = svg
    .append("g")
    .selectAll("g")
    .data(dated)
    .join("g")
    .attr("class", "chart-mark")
    .attr("tabindex", 0)
    .attr("transform", (e) => `translate(${at(e) + nudge(e)},${e.p === null ? base + LANE / 2 : y(e.p)})`);
  dots.append("circle").attr("class", "chart-hit").attr("r", 12);
  dots.append("circle").attr("r", 5).attr("class", (e) => (e.p === null ? "chart-ring is-regex" : "chart-dot is-ringed")).style("fill", (e) => (e.p === null ? null : colorOf.get(e.marker)));
  hover(dots, (event, e) => show(event.currentTarget, e.p === null ? "regex era · no p" : `p ${e.p} · ${e.marker}`, [["day", e.day], ["hour", `${e.hour}:00–${e.hour + 1}:00`], ["judge", e.judge ?? "perpetual's regex"]]), hide);
};
redraw(root, draw);
