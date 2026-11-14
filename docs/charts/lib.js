// The charts' shared chrome: the data fetch, the legend and table toggle, the tooltip, the redraw on resize. Every chart
// mounts into a `.chart` root and draws into its frame; text goes in through d3's .text (textContent), never as HTML.
export const d3 = globalThis.d3;

export const load = async (name) => (await fetch(new URL(`../data/${name}`, import.meta.url))).json();

// a legend item: { label, color?, mark: "rect" | "ring" | "dot" | "both" | "line" | "dash" | "stub", icon?, doc? }
const swatch = (li, { color, mark = "rect" }) => {
  const svg = li.append("svg").attr("class", "chart-key").attr("width", 16).attr("height", 12).attr("aria-hidden", "true");
  if (mark === "rect") svg.append("rect").attr("x", 4).attr("y", 2).attr("width", 8).attr("height", 8).attr("rx", 2).style("fill", color);
  if (mark === "dot") svg.append("circle").attr("cx", 8).attr("cy", 6).attr("r", 4).style("fill", color);
  if (mark === "ring" || mark === "both") svg.append("circle").attr("cx", 8).attr("cy", 6).attr("r", mark === "both" ? 5 : 3.5).attr("class", "chart-ring").style("stroke", color);
  if (mark === "both") svg.append("circle").attr("cx", 8).attr("cy", 6).attr("r", 2.5).style("fill", color);
  if (mark === "line" || mark === "dash") svg.append("line").attr("x1", 1).attr("x2", 15).attr("y1", 6).attr("y2", 6).attr("class", `chart-keyline is-${mark}`).style("stroke", color);
  if (mark === "stub") svg.append("rect").attr("x", 1).attr("y", 2).attr("width", 14).attr("height", 8).attr("rx", 2).attr("class", "chart-keystub");
};

// mounts the chrome into `root`: a legend, the table toggle (`view` names the drawn side), the frame, a tooltip, the
// table of `head` × `rows`; returns the frame, show(anchor, title, rows) and hide()
export const mount = (root, { head, legend = [], rows, view = "chart" }) => {
  root.replaceChildren();
  const top = d3.select(root);
  const bar = top.append("div").attr("class", "chart-bar");
  const list = bar.append("ul").attr("class", "chart-legend").attr("aria-label", "legend");
  for (const item of legend) {
    const li = list.append("li").attr("title", item.doc ?? null);
    swatch(li, item);
    if (item.icon) li.append("span").attr("class", "chart-icon").attr("aria-hidden", "true").text(item.icon);
    li.append("span").text(item.label);
  }
  const toggle = bar.append("button").attr("type", "button").attr("class", "chart-toggle").attr("aria-pressed", "false").text("table");
  const frame = top.append("div").attr("class", "chart-frame");
  const tip = top.append("div").attr("class", "chart-tip").attr("role", "tooltip").attr("hidden", "");
  const wrap = top.append("div").attr("class", "chart-table").attr("hidden", "");
  const table = wrap.append("table");
  table.append("thead").append("tr").selectAll("th").data(head).join("th").text((d) => d);
  table.append("tbody").selectAll("tr").data(rows).join("tr").selectAll("td").data((r) => r).join("td").text((d) => d);
  const hide = () => tip.attr("hidden", "");
  toggle.on("click", () => {
    const isTable = toggle.attr("aria-pressed") !== "true";
    toggle.attr("aria-pressed", String(isTable)).text(isTable ? view : "table");
    frame.attr("hidden", isTable ? "" : null);
    wrap.attr("hidden", isTable ? null : "");
    hide();
  });
  // anchor: an element, or a client-space { left, bottom }
  const show = (anchor, title, pairs) => {
    tip.selectAll("*").remove();
    tip.append("strong").text(title);
    const dl = tip.append("dl");
    for (const [k, v] of pairs) {
      dl.append("dt").text(k);
      dl.append("dd").text(v);
    }
    tip.attr("hidden", null);
    const box = root.getBoundingClientRect();
    const at = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
    const left = Math.min(Math.max(0, at.left - box.left), box.width - tip.node().offsetWidth);
    tip.style("left", `${left}px`).style("top", `${at.bottom - box.top + 6}px`);
  };
  return { frame, hide, show };
};

// the frame's content width (its 16px padding off both sides), at least `min`
export const widthOf = (frame, min) => Math.max(min, frame.node().clientWidth - 32);

// draw now and again whenever the root's width changes
export const redraw = (root, draw) => {
  draw();
  let last = root.clientWidth;
  new ResizeObserver(() => {
    if (root.clientWidth !== last) {
      last = root.clientWidth;
      draw();
    }
  }).observe(root);
};

// hover and focus on a selection: enter(event, d) then show; leave hides
export const hover = (sel, enter, leave) =>
  sel.on("pointerenter focus", (event, d) => enter(event, d)).on("pointerleave blur", (event, d) => leave(event, d));
