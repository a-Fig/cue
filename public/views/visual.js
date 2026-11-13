// Drawn visuals (#61): an SVG (or a small HTML/CSS block) that Claude writes for what Mermaid and
// bullets draw badly: a big number with an icon, a bar or line chart from numbers just said, a
// timeline, a labelled illustration. Two layers keep it inert: sanitize.js strips everything but
// drawing and text, and the result is shown as an <img> of an SVG, which the browser's own rules
// keep from running scripts or loading anything. The page never inserts model markup into itself.
//
// It used to render in a sandboxed <iframe srcdoc>. In a real call Recall's capture browser showed
// that iframe as a blank box under the title (Tyler, 2026-11-13), while images paint everywhere.
// An image can't load the brand's web fonts, so text falls back to the faces named after them.
import { mountView, clip } from "./mount.js";
import { sanitizeMarkup } from "./sanitize.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// The frame's canvas (visual.css): an SVG with this viewBox fills it exactly.
const W = 1136, H = 470;
const SANS = `"Segoe UI", Helvetica, Arial, sans-serif`;

// The palette and faces come from the page's live tokens (style.css), so a restyle carries into
// drawings without touching the prompt. Claude colours shapes and text with these classes instead
// of hex values: ink, accent, muted, line, paper, hl (the highlighter, a fill behind ink text
// only), and display for big numbers and headings.
const TOKENS = ["--cue-blue", "--cue-lime", "--cue-paper", "--cue-paper-dim", "--cue-ink", "--cue-ink-muted", "--cue-line", "--cue-font-display", "--cue-font-body"];
function base() {
  const css = getComputedStyle(document.documentElement);
  // Values are the page's own CSS; drop anything that could close the style element or break XML.
  const vars = TOKENS.map((t) => `${t}: ${css.getPropertyValue(t).replace(/[<>&{};\\]/g, "").trim() || "initial"};`).join(" ");
  return `
:root { ${vars} }
svg, text { font-family: var(--cue-font-body), ${SANS}; }
svg { fill: var(--cue-ink); font-size: 28px; }
.html-root { width: ${W}px; height: ${H}px; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column;
  justify-content: safe center; color: var(--cue-ink); font: 28px/1.3 var(--cue-font-body), ${SANS}; }
.html-root svg { max-width: 100%; height: auto; }
.ink { fill: var(--cue-ink); color: var(--cue-ink); } .accent { fill: var(--cue-blue); color: var(--cue-blue); }
.muted { fill: var(--cue-ink-muted); color: var(--cue-ink-muted); } .line { fill: var(--cue-line); }
.paper { fill: var(--cue-paper-dim); } .hl { fill: var(--cue-lime); }
.line, .stroke { stroke: var(--cue-line); } .accent-stroke { stroke: var(--cue-blue); fill: none; }
.display { font-family: var(--cue-font-display), ${SANS}; font-weight: 650; letter-spacing: -0.01em; }`;
}

// Builds the outer <svg> for the image: the drawing itself for kind "svg", or the HTML wrapped in
// a <foreignObject> for kind "html". Markup is parsed as HTML and serialized as XML, since an SVG
// image must be well-formed XML and the model's markup needn't be.
function imageFor({ html, kind }, title) {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const doc = document.implementation.createDocument(SVG_NS, "svg", null);
  let svg = doc.documentElement;
  if (kind === "svg") {
    svg = doc.importNode(body.firstElementChild, true);
    doc.replaceChild(svg, doc.documentElement);
  } else {
    const fo = doc.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("width", W); fo.setAttribute("height", H);
    const root = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    root.setAttribute("class", "html-root");
    for (const n of [...body.childNodes]) root.appendChild(doc.importNode(n, true));
    fo.appendChild(root);
    svg.appendChild(fo);
  }
  if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const style = doc.createElementNS(SVG_NS, "style");
  style.textContent = base();
  svg.insertBefore(style, svg.firstChild);
  const img = document.createElement("img");
  img.alt = title || "visual";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(doc));
  return img;
}

/** @param {{title: string, markup: string}} input */
export async function showVisual(input, view) {
  const clean = sanitizeMarkup(input.markup, new DOMParser());
  if (!clean.html) return console.log("[cue] show_visual: nothing drawable left after cleaning");
  const el = await mountView("visual", `<h1></h1><div class="visual-box"></div>`);
  el.classList.add("sheet");
  const title = clip(input.title, 80);
  el.querySelector("h1").textContent = title;
  el.classList.toggle("untitled", !title);
  el.querySelector(".visual-box").replaceChildren(imageFor(clean, title));
  view.show("visual");
  view.screen({ mode: "visual", title, kind: clean.kind });
  view.remember(`visual: ${title}`);
}
