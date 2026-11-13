// Drawn visuals (#61): an SVG (or a small HTML/CSS block) that Claude writes for what Mermaid and
// bullets draw badly: a big number with an icon, a bar or line chart from numbers just said, a
// timeline, a labelled illustration. Two layers keep it inert: sanitize.js strips everything but
// drawing and text, and the result renders in an iframe sandboxed without scripts or same-origin,
// under a CSP that loads only the brand's fonts. The page never inserts model markup into itself.
import { mountView, clip } from "./mount.js";
import { sanitizeMarkup } from "./sanitize.js";

const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:";
// The page's own font stylesheet (index.html), so the drawing uses whatever faces the screen uses.
const fonts = () => document.querySelector('link[href^="https://fonts.googleapis.com/css2"]')?.href || "";

// The palette and faces come from the page's live tokens (style.css), so a restyle carries into
// drawings without touching the prompt. Claude colours shapes and text with these classes instead
// of hex values: ink, accent, muted, line, paper, hl (the highlighter, a fill behind ink text
// only), and display for big numbers and headings.
const TOKENS = ["--cue-blue", "--cue-lime", "--cue-paper", "--cue-paper-dim", "--cue-ink", "--cue-ink-muted", "--cue-line", "--cue-font-display", "--cue-font-body"];
function base() {
  const css = getComputedStyle(document.documentElement);
  // Values are the page's own CSS; drop anything that could close the style element.
  const vars = TOKENS.map((t) => `${t}: ${css.getPropertyValue(t).replace(/[<>{};\\]/g, "").trim() || "initial"};`).join(" ");
  return `
:root { ${vars} }
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
body { color: var(--cue-ink); font: 28px/1.3 var(--cue-font-body); }
body.svg { display: grid; place-items: center; }
body.svg > svg { width: 100%; height: 100%; display: block; font-family: var(--cue-font-body); fill: var(--cue-ink); }
body.html { display: flex; flex-direction: column; justify-content: safe center; box-sizing: border-box; padding: 8px; }
body.html svg { max-width: 100%; height: auto; }
.ink { fill: var(--cue-ink); color: var(--cue-ink); } .accent { fill: var(--cue-blue); color: var(--cue-blue); }
.muted { fill: var(--cue-ink-muted); color: var(--cue-ink-muted); } .line { fill: var(--cue-line); }
.paper { fill: var(--cue-paper-dim); } .hl { fill: var(--cue-lime); }
.line, .stroke { stroke: var(--cue-line); } .accent-stroke { stroke: var(--cue-blue); fill: none; }
.display { font-family: var(--cue-font-display); font-weight: 650; letter-spacing: -0.01em; }`;
}

function srcdoc({ html, kind }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<link rel="stylesheet" href="${fonts()}"><style>${base()}</style></head>
<body class="${kind}">${html}</body></html>`;
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
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", ""); // no scripts, no same-origin, no forms, no navigation
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = title || "visual";
  frame.srcdoc = srcdoc(clean);
  el.querySelector(".visual-box").replaceChildren(frame);
  view.show("visual");
  view.screen({ mode: "visual", title, kind: clean.kind });
  view.remember(`visual: ${title}`);
}
