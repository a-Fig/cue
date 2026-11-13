// Drawn visuals (#61): an SVG (or a small HTML/CSS block) that Claude writes for what Mermaid and
// bullets draw badly: a big number with an icon, a bar or line chart from numbers just said, a
// timeline, a labelled illustration. Two layers keep it inert: sanitize.js strips everything but
// drawing and text, and the result renders in an iframe sandboxed without scripts or same-origin,
// under a CSP that loads only the brand's fonts. The page never inserts model markup into itself.
import { mountView, clip } from "./mount.js";
import { sanitizeMarkup } from "./sanitize.js";

const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:";
const FONTS = "https://fonts.googleapis.com/css2?family=Cal+Sans&family=JetBrains+Mono&family=Lato:wght@400;700&display=swap";

// The brand's tokens (brand/tokens.css), so `var(--cue-blue)` works in the model's CSS, and the
// type defaults readable at Meet-tile size.
const BASE = `
:root { --cue-blue: #3168b0; --cue-lime: #ddff8f; --cue-paper: #fefff4; --cue-paper-dim: #eef0e0;
  --cue-ink: #242515; --cue-ink-muted: #6b6c5c; --cue-line: #e4e6d6;
  --cue-font-display: "Cal Sans", "Inter", system-ui, sans-serif; --cue-font-body: "Lato", system-ui, sans-serif; }
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
body { color: var(--cue-ink); font: 28px/1.3 var(--cue-font-body); }
body.svg { display: grid; place-items: center; }
body.svg > svg { width: 100%; height: 100%; display: block; font-family: var(--cue-font-body); }
body.html { display: flex; flex-direction: column; justify-content: center; box-sizing: border-box; padding: 8px; }`;

function srcdoc({ html, kind }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<link rel="stylesheet" href="${FONTS}"><style>${BASE}</style></head>
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
