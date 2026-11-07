// The state matrix: rows the $.state atoms, columns the hooks that touch one (grouped by file), a mark where a hook
// reads (ring), writes (dot) or both; then what resets each and whether it is live. From docs/data/hooks.json.
import { d3, hover, load, mount, redraw, widthOf } from "./lib.js";

const root = document.getElementById("atom-matrix");
const data = await load("hooks.json");

const ROW = 26;
const HEAD = 44;
const NAME = 96;
const RESET = 190;
const STATUS = 70;
const MIN_COL = 76;

const touches = (h) => h.reads.length + h.writes.length > 0;
const files = [...new Set(data.hooks.filter(touches).map((h) => h.file))];
const hooks = files.flatMap((file) => data.hooks.filter((h) => h.file === file && touches(h)));
const atoms = data.atoms.map((a) => ({ ...a, status: a.file === null ? "planned" : "live" }));
const access = (h, a) => (h.reads.includes(a.name) ? "r" : "") + (h.writes.includes(a.name) ? "w" : "");
const WORD = { r: "reads", rw: "reads and writes", w: "writes" };
const MARK = { r: "ring", rw: "both", w: "dot" };
const by = (a, mode) => hooks.filter((h) => access(h, a).includes(mode)).map((h) => h.id).join(", ") || "—";

const { frame, hide, show } = mount(root, {
  head: ["atom", "file", "read by", "written by", "reset by", "status", "doc"],
  legend: Object.entries(MARK).map(([k, mark]) => ({ color: "var(--kind-1)", label: WORD[k], mark })).concat({ label: "planned", mark: "stub" }),
  rows: atoms.map((a) => [a.name, a.file ?? "—", by(a, "r"), by(a, "w"), a.resetBy, a.status, a.doc]),
});

const draw = () => {
  frame.selectAll("*").remove();
  hide();
  const width = widthOf(frame, NAME + hooks.length * MIN_COL + RESET + STATUS);
  const col = (width - NAME - RESET - STATUS) / hooks.length;
  const x = (i) => NAME + i * col;
  const height = HEAD + atoms.length * ROW;
  const svg = frame.append("svg").attr("class", "chart-matrix").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", `state matrix: ${atoms.length} atoms × ${hooks.length} hooks`);

  // headers: the file over its hooks, then each hook's function; the last two columns
  const heads = svg.append("g").attr("class", "chart-heads");
  for (const file of files) {
    const first = hooks.findIndex((h) => h.file === file);
    const n = hooks.filter((h) => h.file === file).length;
    heads.append("text").attr("class", "is-group").attr("x", x(first) + 6).attr("y", 13).text(file);
    heads.append("line").attr("class", "chart-rule").attr("x1", x(first) + 6).attr("x2", x(first + n) - 6).attr("y1", 19).attr("y2", 19);
  }
  heads.append("text").attr("x", 0).attr("y", HEAD - 10).text("atom");
  heads.append("text").attr("x", x(hooks.length) + 12).attr("y", HEAD - 10).text("reset by");
  heads.append("text").attr("x", x(hooks.length) + RESET).attr("y", HEAD - 10).text("status");
  const colSel = svg.append("g").selectAll("g").data(hooks).join("g").attr("class", "chart-col").attr("tabindex", 0).attr("transform", (h, i) => `translate(${x(i)},0)`);
  colSel.append("rect").attr("class", "chart-colband").attr("x", 2).attr("y", HEAD - 26).attr("width", col - 4).attr("height", height - HEAD + 26).attr("rx", 4);
  colSel.append("rect").attr("class", "chart-hit").attr("y", HEAD - 26).attr("width", col).attr("height", 26);
  colSel.append("text").attr("class", "chart-colhead").attr("x", col / 2).attr("y", HEAD - 10).attr("text-anchor", "middle").text((h) => h.fn);

  const rowSel = svg.append("g").selectAll("g").data(atoms).join("g").attr("class", "chart-row").classed("is-stub", (a) => a.status === "planned").attr("transform", (a, i) => `translate(0,${HEAD + i * ROW})`);
  rowSel.append("rect").attr("class", "chart-band").attr("width", width).attr("height", ROW - 2).attr("rx", 4);
  rowSel.append("text").attr("class", "chart-name").attr("x", 8).attr("y", ROW / 2 + 3).text((a) => a.name);
  rowSel.append("text").attr("class", "chart-dim").attr("x", x(hooks.length) + 12).attr("y", ROW / 2 + 3).text((a) => a.resetBy);
  rowSel.append("text").attr("class", "chart-dim").attr("x", x(hooks.length) + RESET).attr("y", ROW / 2 + 3).text((a) => a.status);

  const cells = rowSel
    .selectAll("g.chart-cell")
    .data((a) => hooks.map((h, i) => ({ a, h, i, mode: access(h, a) })).filter((c) => c.mode !== ""))
    .join("g")
    .attr("class", "chart-cell")
    .attr("tabindex", 0)
    .attr("transform", (c) => `translate(${x(c.i) + col / 2},${(ROW - 2) / 2})`);
  cells.append("rect").attr("class", "chart-hit").attr("x", -14).attr("y", -12).attr("width", 28).attr("height", 24);
  cells.filter((c) => c.mode.includes("r")).append("circle").attr("class", "chart-ring").attr("r", (c) => (c.mode === "rw" ? 7 : 5)).style("stroke", "var(--kind-1)");
  cells.filter((c) => c.mode.includes("w")).append("circle").attr("r", (c) => (c.mode === "rw" ? 3.5 : 5)).style("fill", "var(--kind-1)");

  // a lit atom row and the hooks touching it, or a lit hook column and the atoms it touches
  const light = (atom, hook) => {
    svg.classed("is-focus", atom !== null || hook !== null);
    rowSel.classed("is-lit", (a) => a === atom || (hook !== null && access(hook, a) !== ""));
    colSel.classed("is-lit", (h) => h === hook || (atom !== null && access(h, atom) !== ""));
  };
  const off = () => {
    light(null, null);
    hide();
  };
  hover(rowSel.select(".chart-band"), (event, a) => light(a, null), off);
  rowSel.select(".chart-name").style("pointer-events", "none");
  hover(colSel, (event, h) => {
    light(null, h);
    show(event.currentTarget.querySelector("text"), `${h.id} — ${h.does}`, [["reads", h.reads.join(", ") || "—"], ["writes", h.writes.join(", ") || "—"], ["file", h.file]]);
  }, off);
  hover(cells, (event, c) => {
    event.stopPropagation();
    light(c.a, null);
    colSel.classed("is-lit", (h) => h === c.h);
    show(event.currentTarget, `${c.a.name} · ${WORD[c.mode]} by ${c.h.fn}`, [["atom", c.a.doc], ["file", c.a.file ?? "—"], ["hook", `${c.h.id} — ${c.h.does}`], ["reset by", c.a.resetBy]]);
  }, off);
};
redraw(root, draw);
