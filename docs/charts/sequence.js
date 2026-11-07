// One tool call as a sequence diagram: the lifelines from docs/data/sequence.json, its messages top to bottom, the
// denied, refused and failed paths and the unawaited shadow as dashed frames. A write wears its effect kind's hue from
// docs/data/hooks.json, the same as the hook graph; scripts/charts.ts checks every write names one of those effects.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("call-sequence");
const [data, hooks] = await Promise.all([load("sequence.json"), load("hooks.json")]);

const ROW = 30;
const TOP = 44;
const LOOP = 26;
const TAB = 18;
const CHAR = 7.3;
const MIN_GAP = 128;

const slot = new Map(hooks.kinds.map((k, i) => [k.name, i + 1]));
const kindOf = new Map(hooks.hooks.flatMap((h) => h.effects.map((e) => [e.target, e.kind])));
const colorOf = (m) => (m.kind === "write" ? `var(--kind-${slot.get(kindOf.get(m.target))})` : m.kind === "deny" ? "var(--ui-danger)" : "var(--ui-fg-muted)");
const labelOf = (m) => (m.kind === "deny" ? `⊘ ${m.label}` : m.kind === "write" ? `${m.label} → ${m.target}` : m.label);
const actor = new Map(data.actors.map((a, i) => [a.name, { ...a, i }]));
const messages = data.messages.map((m, i) => ({ ...m, frame: data.frames.find((f) => f.first <= i && i <= f.last), i }));
const writeKinds = [...new Set(messages.filter((m) => m.kind === "write").map((m) => kindOf.get(m.target)))];

const { frame, hide, show } = mount(root, {
  head: ["#", "from", "to", "kind", "message", "note", "frame"],
  legend: [
    { color: "var(--ui-fg-muted)", label: "call", mark: "line" },
    { color: "var(--ui-fg-muted)", label: "return", mark: "dash" },
    ...writeKinds.map((k) => ({ color: `var(--kind-${slot.get(k)})`, label: `write · ${k}` })),
    { color: "var(--ui-danger)", icon: "⊘", label: "deny", mark: "line" },
    { label: "alt / opt path", mark: "stub" },
  ],
  rows: messages.map((m) => [m.i + 1, m.from, m.to, m.kind, m.kind === "write" ? `${m.label} → ${m.target}` : m.label, m.note ?? "—", m.frame ? `${m.frame.kind} · ${m.frame.label}` : "—"]),
  view: "diagram",
});

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const width = widthOf(frame, data.actors.length * MIN_GAP);
  const gap = width / data.actors.length;
  const x = (name) => gap * (actor.get(name).i + 0.5);
  // a frame's first message drops a row's worth, so its tab never sits on a label
  const y = (i) => TOP + 18 + i * ROW + TAB * data.frames.filter((f) => f.first <= i).length;
  const height = y(messages.length - 1) + ROW;
  const svg = frame.append("svg").attr("class", "chart-seq").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", `tool call sequence: ${data.actors.length} lifelines, ${messages.length} messages`);

  // frames under everything: dashed, a tab naming the path
  const span = (f) => {
    const xs = messages.slice(f.first, f.last + 1).flatMap((m) => [x(m.from), x(m.to) + (m.from === m.to ? LOOP : 0)]);
    return [Math.min(...xs) - gap * 0.42, Math.max(...xs) + gap * 0.42];
  };
  const frames = svg.append("g").selectAll("g").data(data.frames).join("g").attr("class", "chart-seqframe");
  const top = (f) => y(f.first) - ROW - TAB + 14;
  frames.append("rect").attr("x", (f) => span(f)[0]).attr("y", top).attr("width", (f) => span(f)[1] - span(f)[0]).attr("height", (f) => y(f.last) + 12 - top(f)).attr("rx", 4);
  frames.append("text").attr("x", (f) => span(f)[0] + 8).attr("y", (f) => top(f) + 13).text((f) => `${f.kind} · ${f.label}`);

  // lifelines and their heads
  const lanes = svg.append("g").selectAll("g").data(data.actors).join("g").attr("class", "chart-lane").attr("tabindex", 0);
  lanes.append("line").attr("x1", (a) => x(a.name)).attr("x2", (a) => x(a.name)).attr("y1", 28).attr("y2", height);
  lanes.append("rect").attr("x", (a) => x(a.name) - gap / 2 + 8).attr("y", 4).attr("width", gap - 16).attr("height", 24).attr("rx", 6);
  lanes.append("text").attr("x", (a) => x(a.name)).attr("y", 20).attr("text-anchor", "middle").text((a) => a.label);

  // messages: an arrow (a loop for a self-message), its head, its label haloed over what it crosses
  const head = (m) => {
    const tx = m.from === m.to ? x(m.from) + 1 : x(m.to);
    const dir = m.from === m.to || x(m.to) < x(m.from) ? 1 : -1;
    const ty = m.from === m.to ? y(m.i) + 8 : y(m.i);
    return `M${tx + dir * 7},${ty - 4}L${tx},${ty}L${tx + dir * 7},${ty + 4}`;
  };
  const path = (m) => (m.from === m.to ? `M${x(m.from)},${y(m.i) - 6}h${LOOP}v14h${-LOOP + 1}` : `M${x(m.from)},${y(m.i)}H${x(m.to)}`);
  const msgSel = svg.append("g").selectAll("g").data(messages).join("g").attr("class", (m) => `chart-msg is-${m.kind}`).attr("tabindex", 0);
  msgSel.append("rect").attr("class", "chart-hit").attr("x", (m) => Math.min(x(m.from), x(m.to)) - 4).attr("y", (m) => y(m.i) - ROW + 8).attr("width", (m) => Math.abs(x(m.to) - x(m.from)) + (m.from === m.to ? LOOP + 8 : 8)).attr("height", ROW - 2);
  msgSel.append("path").attr("class", "chart-arrow").attr("d", path).style("stroke", colorOf);
  msgSel.append("path").attr("class", "chart-head").attr("d", head).style("stroke", colorOf).classed("is-open", (m) => m.kind === "return");
  // a self-message's label runs right of its loop, or left of its lifeline when the right has no room
  const isLeft = (m) => m.from === m.to && x(m.from) + LOOP + 6 + labelOf(m).length * CHAR > width;
  msgSel
    .append("text")
    .attr("class", "chart-halo")
    .attr("x", (m) => (m.from !== m.to ? (x(m.from) + x(m.to)) / 2 : isLeft(m) ? x(m.from) - 8 : x(m.from) + LOOP + 6))
    .attr("y", (m) => (m.from === m.to ? y(m.i) + 5 : y(m.i) - 5))
    .attr("text-anchor", (m) => (m.from !== m.to ? "middle" : isLeft(m) ? "end" : "start"))
    .text(labelOf);
  msgSel.filter((m) => m.kind === "write").append("rect").attr("x", (m) => x(m.from) + LOOP - 4).attr("y", (m) => y(m.i) - 2).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", colorOf);

  const light = (lit) => {
    svg.classed("is-focus", lit !== null);
    msgSel.classed("is-lit", (m) => lit?.has(m) ?? false);
    lanes.classed("is-lit", (a) => [...(lit ?? [])].some((m) => m.from === a.name || m.to === a.name));
  };
  const off = () => {
    light(null);
    hide();
  };
  hover(msgSel, (event, m) => {
    light(new Set([m]));
    show(event.currentTarget.querySelector("text"), `${m.i + 1} · ${labelOf(m)}`, [
      ["from → to", `${actor.get(m.from).label} → ${actor.get(m.to).label}`],
      ["kind", m.kind],
      ...(m.note ? [["note", m.note]] : []),
      ...(m.frame ? [["path", `${m.frame.kind} · ${m.frame.label}`]] : []),
    ]);
  }, off);
  hover(lanes, (event, a) => {
    light(new Set(messages.filter((m) => m.from === a.name || m.to === a.name)));
    show(event.currentTarget.querySelector("rect"), a.label, [["is", a.doc], ["messages", String(messages.filter((m) => m.from === a.name || m.to === a.name).length)]]);
  }, off);
};
redraw(root, draw);
