// Each System One judge's availability as a state machine, TypeSafe and Kev side by side, the fallback between them and
// what happens when neither is up. States, transitions and every number from docs/data/judge.json, whose constants
// scripts/charts.ts reads back out of judge.ts and markers.ts, so a number here is the code's.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("judge-states");
const data = await load("judge.json");

const NODE = { h: 40, w: 150 };
const STEP = 84;
const TOP = 64;
const MID = 72;
const MIN_PANEL = 520;

const constants = Object.assign({}, ...Object.values(data.constants));
const fmt = (text) => text.replaceAll(/\{(\w+)\}/gu, (_, name) => (name.endsWith("_MS") ? `${constants[name] / 1000} s` : String(constants[name])));
const ICON = { danger: "✕", ok: "✓", warn: "◔" };
const has = (item, judge) => item.judges === undefined || item.judges.includes(judge.name);
const judges = data.judges.map((j) => {
  const states = data.states.filter((s) => has(s, j));
  // one edge per (from, to), its labels joined
  const edges = d3.groups(data.transitions.filter((t) => has(t, j)), (t) => `${t.from}→${t.to}`).map(([, ts]) => ({ from: ts[0].from, judge: j, on: ts.map((t) => fmt(t.on)).join(" · "), to: ts[0].to }));
  return { ...j, edges, states };
});

const { frame, hide, show } = mount(root, {
  head: ["judge", "from", "to", "on"],
  legend: [
    { color: "var(--ui-ok)", icon: ICON.ok, label: "up" },
    { color: "var(--ui-danger)", icon: ICON.danger, label: "down" },
    { color: "var(--ui-warn)", icon: ICON.warn, label: "busy" },
  ],
  rows: [
    ...judges.flatMap((j) => j.edges.map((e) => [j.label, e.from, e.to, e.on])),
    ...Object.entries(data.constants).flatMap(([file, cs]) => Object.entries(cs).map(([name, value]) => ["constant", file, name, String(value)])),
  ],
  view: "diagram",
});

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const width = widthOf(frame, 2 * MIN_PANEL + MID);
  const pw = (width - MID) / 2;
  const rows = Math.max(...judges.map((j) => j.states.length - 1));
  const body = rows * STEP;
  const height = TOP + body + 70;
  const svg = frame.append("svg").attr("class", "chart-states").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", "judge state machines: TypeSafe and Kev");

  // per judge: where each state sits — up on the left, mid-height; the down states stacked on the right
  const place = (j, k) => {
    const ox = k * (pw + MID);
    const downs = j.states.filter((s) => s.name !== "up");
    const top = TOP + (body - (downs.length - 1) * STEP) / 2 - NODE.h / 2;
    const at = new Map(downs.map((s, i) => [s.name, { x: ox + pw - NODE.w, y: top + i * STEP }]));
    at.set("up", { x: ox, y: TOP + body / 2 - NODE.h / 2 });
    return at;
  };
  const panels = judges.map((j, k) => ({ at: place(j, k), j, ox: k * (pw + MID) }));

  const heads = svg.append("g").attr("class", "chart-heads");
  for (const { j, ox } of panels) {
    heads.append("text").attr("class", "is-title").attr("x", ox).attr("y", 16).text(`${j.label} · ${j.model}`);
    heads.append("text").attr("class", "is-group").attr("x", ox).attr("y", 34).text(`${j.url} · ${fmt(`{${j.timeout}}`)} a call · probe ${fmt("{PROBE_MS}")}`);
  }

  // the fallback between the panels, and the end when neither answers
  const fx = pw + 6;
  const fy = TOP + body / 2 - NODE.h / 2 - 18;
  const fall = svg.append("g").attr("class", "chart-fall").attr("tabindex", 0);
  fall.append("rect").attr("class", "chart-hit").attr("x", fx).attr("y", fy - 22).attr("width", MID - 12).attr("height", 30);
  fall.append("path").attr("class", "chart-fallback").attr("d", `M${fx},${fy}H${fx + MID - 12}M${fx + MID - 19},${fy - 4}L${fx + MID - 12},${fy}L${fx + MID - 19},${fy + 4}`);
  fall.append("text").attr("class", "chart-halo is-small").attr("x", fx + (MID - 12) / 2).attr("y", fy - 8).attr("text-anchor", "middle").text("else Kev");
  const ny = height - 22;
  const sink = svg.append("g").attr("class", "chart-sink").attr("tabindex", 0);
  sink.append("path").attr("class", "chart-fallback is-dashed").attr("d", panels.map(({ at }) => `M${at.get("up").x + NODE.w / 2},${at.get("up").y + NODE.h}V${ny}H${width / 2}`).join(""));
  sink.append("rect").attr("x", width / 2 - 150).attr("y", ny - 14).attr("width", 300).attr("height", 26).attr("rx", 13);
  sink.append("text").attr("x", width / 2).attr("y", ny + 3).attr("text-anchor", "middle").text("neither up → no event, one dim log line");

  // transitions: out of up bowed above the chord, back to up bowed below, both meeting the down state at its left
  // edge, where the fan is widest: each label sits there, the way out above, the way back below
  const edges = panels.flatMap(({ at, j }) => j.edges.map((e) => ({ ...e, a: at.get(e.from), b: at.get(e.to) })));
  const geo = (e) => {
    const out = e.from === "up";
    const [up, down] = out ? [e.a, e.b] : [e.b, e.a];
    const u = { x: up.x + NODE.w, y: up.y + NODE.h / 2 + (out ? -6 : 6) };
    const d = { x: down.x, y: down.y + NODE.h / 2 + (out ? -6 : 6) };
    const [p, q] = out ? [u, d] : [d, u];
    const c = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 + (out ? -18 : 18) };
    const angle = Math.atan2(q.y - c.y, q.x - c.x);
    const tip = (da) => `${q.x - 8 * Math.cos(angle + da)},${q.y - 8 * Math.sin(angle + da)}`;
    return { d: `M${p.x},${p.y}Q${c.x},${c.y} ${q.x},${q.y}`, head: `M${tip(0.45)}L${q.x},${q.y}L${tip(-0.45)}`, label: { x: down.x - 12, y: d.y + (out ? -10 : 20) } };
  };
  const edgeSel = svg.append("g").selectAll("g").data(edges).join("g").attr("class", "chart-edge").classed("is-back", (e) => e.to === "up").attr("tabindex", 0);
  edgeSel.append("path").attr("class", "chart-hitline").attr("d", (e) => geo(e).d);
  edgeSel.append("path").attr("class", "chart-arrow").attr("d", (e) => geo(e).d);
  edgeSel.append("path").attr("class", "chart-head").attr("d", (e) => geo(e).head);
  edgeSel.append("text").attr("class", "chart-halo is-small").attr("x", (e) => geo(e).label.x).attr("y", (e) => geo(e).label.y).attr("text-anchor", "end").text((e) => e.on);

  // states: a rounded node, a status bar and icon, its name
  const nodes = panels.flatMap(({ at, j }) => j.states.map((s) => ({ ...s, at: at.get(s.name), j })));
  const nodeSel = svg.append("g").selectAll("g").data(nodes).join("g").attr("class", "chart-node chart-state").attr("tabindex", 0).attr("transform", (n) => `translate(${n.at.x},${n.at.y})`);
  nodeSel.append("rect").attr("width", NODE.w).attr("height", NODE.h).attr("rx", NODE.h / 2);
  nodeSel.append("circle").attr("class", "chart-status").attr("cx", 20).attr("cy", NODE.h / 2).attr("r", 9).style("fill", (n) => `var(--ui-${n.status})`);
  nodeSel.append("text").attr("class", "chart-status-icon").attr("x", 20).attr("y", NODE.h / 2 + 4).attr("text-anchor", "middle").text((n) => ICON[n.status]);
  nodeSel.append("text").attr("x", 38).attr("y", NODE.h / 2 + 4).text((n) => n.name);

  const off = () => {
    svg.classed("is-focus", false);
    hide();
  };
  const lit = (pick) => {
    svg.classed("is-focus", true);
    edgeSel.classed("is-lit", pick.edge);
    nodeSel.classed("is-lit", pick.node);
  };
  hover(nodeSel, (event, n) => {
    lit({ edge: (e) => e.judge === n.j && (e.from === n.name || e.to === n.name), node: (m) => m === n || (m.j === n.j && n.j.edges.some((e) => (e.from === n.name && e.to === m.name) || (e.to === n.name && e.from === m.name))) });
    show(event.currentTarget, `${n.j.label} · ${n.name}`, [["until", fmt(n.doc)], ["status", n.status]]);
  }, off);
  hover(edgeSel, (event, e) => {
    lit({ edge: (x) => x === e, node: (m) => m.j === e.judge && (m.name === e.from || m.name === e.to) });
    show(event.currentTarget.querySelector("text"), e.on, [["judge", e.judge.label], ["from → to", `${e.from} → ${e.to}`]]);
  }, off);
  hover(fall, (event) => show(event.currentTarget, "fallback", [["when", "TypeSafe is down, or its call brought no answer"], ["then", "the same request to Kev"]]), hide);
  hover(sink, (event) => show(event.currentTarget, "no judge up", [["when", "both judges' until is still ahead"], ["then", "the prompt or call goes on, judged by nothing"]]), off);
};
redraw(root, draw);
