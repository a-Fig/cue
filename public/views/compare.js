// Comparison table (#18): options side by side on a few criteria, for when the room weighs
// choices. Claude fills fixed fields (option names, short cells, an optional pick); the page
// builds the table from text nodes only, so nothing the model writes is ever parsed as HTML (#14).
import { mountView, make, clip } from "./mount.js";

const MAX_OPTIONS = 4;
const MAX_ROWS = 6;

/** @param {{title: string, options: string[], rows: {criterion: string, cells: string[]}[], pick: string, why: string}} input */
export async function showComparison(input, view) {
  const el = await mountView("compare", `
    <h1></h1>
    <table><thead><tr></tr></thead><tbody></tbody></table>
    <p class="why"></p>`);

  const title = clip(input.title, 70);
  const options = (input.options || []).slice(0, MAX_OPTIONS).map((o) => clip(o, 28));
  const rows = (input.rows || []).slice(0, MAX_ROWS);
  const pickIdx = options.findIndex((o) => input.pick && o.toLowerCase() === clip(input.pick, 28).toLowerCase());

  el.querySelector("h1").textContent = title;
  el.classList.toggle("dense", rows.length > 4 || options.length > 3);

  const head = el.querySelector("thead tr");
  head.replaceChildren(make("th", "corner"), ...options.map((o, i) => {
    const th = make("th", i === pickIdx ? "pick" : "", o);
    if (i === pickIdx) th.append(make("span", "badge", "pick"));
    return th;
  }));

  const why = el.querySelector(".why");
  why.textContent = pickIdx >= 0 && input.why ? clip(input.why, 140) : "";

  const fill = (cellMax) => el.querySelector("tbody").replaceChildren(...rows.map((r, ri) => {
    const tr = make("tr");
    tr.style.animationDelay = `${ri * 120}ms`;
    tr.append(make("th", "", clip(r.criterion, 30)));
    options.forEach((_, i) => tr.append(make("td", i === pickIdx ? "pick" : "", clip(r.cells?.[i] ?? "", cellMax))));
    return tr;
  }));

  // Long cells wrap. While the table or its "why" line would run under the caption, tighten the
  // type, then shorten the cells.
  const bottom = () => { const last = why.textContent ? why : el.querySelector("table"); return last.offsetTop + last.offsetHeight; };
  const LIMIT = 720 - 96;
  el.classList.remove("tight");
  fill(60);
  if (bottom() > LIMIT) el.classList.add("tight");
  for (const max of [40, 26]) if (bottom() > LIMIT) fill(max);

  view.show("compare");
  view.screen({ mode: "comparison", title, options, criteria: rows.map((r) => r.criterion), pick: pickIdx >= 0 ? options[pickIdx] : "" });
  view.remember(`comparison: ${title}`);
}
