// Slides (#46): a few fixed layouts the model picks from, so a number, a before/after or a quote
// is presented as one instead of as bullets. Claude fills typed fields; the page builds each layout
// from text nodes only, so nothing the model writes is parsed as HTML (#14). Sizes read in a Meet
// tile at 1280x720: at most 6 bullets, clipped short.
import { mountView, make, clip } from "./mount.js";

const LAYOUTS = ["bullets", "stat", "two_columns", "quote", "section"];
const MAX_BULLETS = 6;

/** @param {{layout: string, title: string, subtitle: string, bullets: string[], big_text: string, columns: {heading: string, bullets: string[]}[]}} input */
export async function showSlide(input, view) {
  const el = await mountView("slide", `<div class="slide-body"></div>`);
  el.classList.add("sheet");
  let layout = LAYOUTS.includes(input.layout) ? input.layout : "bullets";
  const title = clip(input.title, 70);
  const subtitle = clip(input.subtitle, 110);
  const bullets = (input.bullets || []).slice(0, MAX_BULLETS).map((b) => clip(b, 90)).filter(Boolean);
  const big = clip(input.big_text, layout === "quote" ? 220 : 24);
  const columns = (input.columns || []).slice(0, 2).map((c) => ({
    heading: clip(c?.heading, 30),
    bullets: (c?.bullets || []).slice(0, 4).map((b) => clip(b, 60)).filter(Boolean),
  }));
  // A layout missing what it needs falls back to bullets rather than showing an empty slide.
  if ((layout === "stat" || layout === "quote") && !big) layout = "bullets";
  if (layout === "two_columns" && columns.length < 2) layout = "bullets";

  const body = el.querySelector(".slide-body");
  const parts = [];
  const stagger = (node, i) => { node.style.animationDelay = `${i * 90}ms`; return node; };
  if (layout === "section") {
    parts.push(make("p", "kicker", "Next up"), make("h1", "", title));
    if (subtitle) parts.push(make("p", "sub", subtitle));
  } else if (layout === "stat") {
    if (title) parts.push(make("p", "kicker", title));
    parts.push(make("p", "big", big));
    if (subtitle) parts.push(make("p", "sub", subtitle));
    if (bullets.length) parts.push(make("p", "note", bullets.slice(0, 2).join(" · ")));
  } else if (layout === "quote") {
    if (title) parts.push(make("p", "kicker", title));
    const q = make("blockquote", big.length > 120 ? "long" : "", big);
    parts.push(q);
    if (subtitle) parts.push(make("p", "by", `— ${subtitle}`));
  } else if (layout === "two_columns") {
    parts.push(make("h1", "", title));
    const cols = make("div", "cols");
    columns.forEach((c, ci) => {
      const col = make("section", `col col-${ci}`);
      col.append(make("h2", "", c.heading));
      const ul = make("ul");
      ul.append(...c.bullets.map((b, i) => stagger(make("li", "", b), i + ci * 2)));
      col.append(ul);
      cols.append(col);
    });
    parts.push(cols);
  } else {
    parts.push(make("h1", "", title));
    const ul = make("ul", bullets.length > 4 ? "dense" : "");
    ul.append(...bullets.map((b, i) => stagger(make("li", "", b), i)));
    parts.push(ul);
  }
  body.className = `slide-body layout-${layout}`;
  body.replaceChildren(...parts);

  view.show("slide");
  view.screen({ mode: "slide", layout, title, subtitle, bullets, big_text: big, columns });
  view.remember(`slide (${layout}): ${title}`);
}
