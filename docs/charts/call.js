// One tool call as a state machine: the states from docs/data/call.json on their grid, the transitions between them. A
// write wears its effect kind's hue from docs/data/hooks.json, the same as the hook graph; scripts/charts.ts checks
// every write names one of its hook's effects, and the machine's shape.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("call-machine");
const [data, hooks] = await Promise.all([load("call.json"), load("hooks.json")]);

const NODE = { h: 44, w: 104 };
const LEFT = 36;
const TOP = 48;
const ROW = 120;
const BOW = 76;
const WRAP = 28;
const MIN_STEP = 170;

const slot = new Map(hooks.kinds.map((k, i) => [k.name, i + 1]));
const kindOf = (w) => hooks.hooks.find((h) => h.id === w.hook).effects.find((e) => e.target === w.target).kind;
const colorOf = (w) => `var(--kind-${slot.get(kindOf(w))})`;
const owner = new Map(data.owners.map((o) => [o.name, o]));
const state = new Map(data.states.map((s) => [s.name, s]));
const edges = data.transitions.map((t) => ({ ...t, a: state.get(t.from), b: state.get(t.to) }));
const writes = [...data.states, ...data.transitions].flatMap((x) => x.writes ?? []);
const writeKinds = [...new Set(writes.map(kindOf))];
const cols = Math.max(...data.states.map((s) => s.col));
const rows = Math.max(...data.states.map((s) => s.row));
const listOf = (ws = []) => ws.map((w) => `${w.label} → ${w.target} (${w.hook})`).join("; ") || "—";
// a label's lines: its " · " parts, greedily joined up to WRAP characters
const wrap = (text) => text.split(" · ").reduce((lines, part) => (lines.length > 0 && `${lines.at(-1)} · ${part}`.length <= WRAP ? [...lines.slice(0, -1), `${lines.at(-1)} · ${part}`] : [...lines, part]), []);

const { frame, hide, show } = mount(root, {
  head: ["from", "to", "on", "writes"],
  legend: [
    { color: "var(--ui-fg-faint)", label: "state" },
    { color: "var(--ui-fg-muted)", label: "terminal", mark: "ring" },
    { color: "var(--ui-fg-muted)", label: "transition", mark: "line" },
    ...writeKinds.map((k) => ({ color: `var(--kind-${slot.get(k)})`, label: `write · ${k}` })),
  ],
  rows: [...edges.map((e) => [e.from, e.to, e.on, listOf(e.writes)]), ...data.states.filter((s) => s.writes).map((s) => [s.name, "—", "on entry", listOf(s.writes)])],
  view: "diagram",
});

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const width = widthOf(frame, LEFT + cols * MIN_STEP + NODE.w + 8);
  const step = (width - LEFT - NODE.w - 8) / cols;
  const height = TOP + rows * ROW + NODE.h / 2 + 16;
  const at = (s) => ({ cx: LEFT + s.col * step + NODE.w / 2, cy: TOP + s.row * ROW, x: LEFT + s.col * step, y: TOP + s.row * ROW - NODE.h / 2 });
  const svg = frame.append("svg").attr("class", "chart-states").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", `one tool call: ${data.states.length} states, ${edges.length} transitions`);

  // transitions: neighbours a chord, a skip bowed away from the row above when it holds a state over the span, a
  // change of row an L-shaped bend from the top or bottom into the facing side, its label at the bend's middle, outside
  const geo = (e) => {
    const [a, b] = [at(e.a), at(e.b)];
    const dx = Math.sign(e.b.col - e.a.col);
    const dy = Math.sign(e.b.row - e.a.row);
    const quarter = NODE.w / 4;
    const shape = () => {
      if (dy === 0 && Math.abs(e.b.col - e.a.col) === 1) {
        const [p, q] = [{ x: a.cx + (dx * NODE.w) / 2, y: a.cy }, { x: b.cx - (dx * NODE.w) / 2, y: b.cy }];
        return { c: { x: (p.x + q.x) / 2, y: p.y }, label: { anchor: "middle", x: (p.x + q.x) / 2, y: p.y - 8 }, p, q };
      }
      if (dy === 0) {
        const span = (s) => s.row === e.a.row - 1 && s.col >= Math.min(e.a.col, e.b.col) && s.col <= Math.max(e.a.col, e.b.col);
        const up = data.states.some(span) ? 1 : -1;
        const [p, q] = [{ x: a.cx + dx * quarter, y: a.cy + (up * NODE.h) / 2 }, { x: b.cx - dx * quarter, y: b.cy + (up * NODE.h) / 2 }];
        const c = { x: (p.x + q.x) / 2, y: p.y + up * BOW };
        return { c, label: { anchor: "middle", x: c.x, y: p.y + (up * BOW) / 2 + (up > 0 ? 16 : -9) }, p, q };
      }
      if (dx === 0) {
        const [p, q] = [{ x: a.cx, y: a.cy + (dy * NODE.h) / 2 }, { x: b.cx, y: b.cy - (dy * NODE.h) / 2 }];
        return { c: { x: p.x, y: (p.y + q.y) / 2 }, label: { anchor: "start", x: p.x + 6, y: (p.y + q.y) / 2 }, p, q };
      }
      const [p, q] = [{ x: a.cx + dx * quarter, y: a.cy + (dy * NODE.h) / 2 }, { x: b.cx - (dx * NODE.w) / 2, y: b.cy }];
      const c = { x: p.x, y: q.y };
      const m = { x: 0.75 * p.x + 0.25 * q.x, y: 0.25 * p.y + 0.75 * q.y };
      return { c, label: { anchor: dx > 0 ? "end" : "start", x: m.x - dx * 10, y: m.y + dy * 10 }, p, q };
    };
    const { c, label, p, q } = shape();
    const angle = Math.atan2(q.y - c.y, q.x - c.x);
    const tip = (da) => `${q.x - 8 * Math.cos(angle + da)},${q.y - 8 * Math.sin(angle + da)}`;
    return { d: `M${p.x},${p.y}Q${c.x},${c.y} ${q.x},${q.y}`, head: `M${tip(0.45)}L${q.x},${q.y}L${tip(-0.45)}`, label };
  };
  const edgeSel = svg.append("g").selectAll("g").data(edges).join("g").attr("class", "chart-edge").attr("tabindex", 0);
  edgeSel.append("path").attr("class", "chart-hitline").attr("d", (e) => geo(e).d);
  edgeSel.append("path").attr("class", "chart-arrow").attr("d", (e) => geo(e).d);
  edgeSel.append("path").attr("class", "chart-head").attr("d", (e) => geo(e).head);
  const labels = edgeSel.append("text").attr("class", "chart-halo is-small").attr("text-anchor", (e) => geo(e).label.anchor);
  labels.selectAll("tspan").data((e) => wrap(e.on).map((line, i, all) => ({ dy: i === 0 ? 4 - ((all.length - 1) * 13) / 2 : 13, label: geo(e).label, line }))).join("tspan").attr("x", (t) => t.label.x).attr("y", (t, i) => (i === 0 ? t.label.y : null)).attr("dy", (t) => t.dy).text((t) => t.line);
  // a write's badge just before its label's first line
  edgeSel.filter((e) => e.writes).each(function badge(e) {
    const box = this.querySelector("text").getBBox();
    d3.select(this).append("rect").attr("class", "chart-badge").attr("x", box.x - 12).attr("y", box.y + 3).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", colorOf(e.writes[0]));
  });

  // states: a rounded node, its name, its owner; a terminal ringed, the initial a dot and arrow in
  const nodeSel = svg.append("g").selectAll("g").data(data.states).join("g").attr("class", "chart-node chart-state").attr("tabindex", 0).attr("transform", (s) => `translate(${at(s).x},${at(s).y})`);
  nodeSel.append("rect").attr("width", NODE.w).attr("height", NODE.h).attr("rx", NODE.h / 2);
  nodeSel.filter((s) => s.terminal).append("rect").attr("class", "chart-final").attr("x", -4).attr("y", -4).attr("width", NODE.w + 8).attr("height", NODE.h + 8).attr("rx", NODE.h / 2 + 4);
  nodeSel.append("text").attr("x", NODE.w / 2).attr("y", 19).attr("text-anchor", "middle").text((s) => s.name);
  nodeSel.append("text").attr("class", "chart-owner").attr("x", NODE.w / 2).attr("y", 34).attr("text-anchor", "middle").text((s) => s.owner);
  nodeSel.filter((s) => s.writes).append("rect").attr("class", "chart-badge").attr("x", NODE.w - 18).attr("y", NODE.h / 2 - 4).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", (s) => colorOf(s.writes[0]));
  const start = nodeSel.filter((s) => s.initial);
  start.append("circle").attr("class", "chart-initial").attr("cx", -28).attr("cy", NODE.h / 2).attr("r", 5);
  start.append("path").attr("class", "chart-head").attr("d", `M-23,${NODE.h / 2}H-1M-8,${NODE.h / 2 - 4}L-1,${NODE.h / 2}L-8,${NODE.h / 2 + 4}`);

  const off = () => {
    svg.classed("is-focus", false);
    hide();
  };
  const lit = (pick) => {
    svg.classed("is-focus", true);
    edgeSel.classed("is-lit", pick.edge);
    nodeSel.classed("is-lit", pick.node);
  };
  const touches = (e, s) => e.a === s || e.b === s;
  hover(nodeSel, (event, s) => {
    lit({ edge: (e) => touches(e, s), node: (m) => m === s || edges.some((e) => touches(e, s) && touches(e, m)) });
    show(event.currentTarget, `${s.name} · ${s.owner}`, [
      ["is", s.doc],
      ["owner", owner.get(s.owner).doc],
      ...(s.writes ?? []).map((w) => ["on entry", `${w.label} → ${w.target} (by ${w.hook})`]),
      ...["initial", "terminal"].filter((flag) => s[flag]).map((flag) => [flag, "yes"]),
    ]);
  }, off);
  hover(edgeSel, (event, e) => {
    lit({ edge: (x) => x === e, node: (m) => m === e.a || m === e.b });
    show(event.currentTarget.querySelector("text"), e.on, [
      ["from → to", `${e.from} → ${e.to}`],
      ...(e.writes ?? []).map((w) => ["writes", `${w.label} → ${w.target} (by ${w.hook})`]),
    ]);
  }, off);
};
redraw(root, draw);
