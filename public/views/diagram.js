// Diagrams (#46): Mermaid in the brand's colors, sized to read at 720p, fitted to the stage, with a
// plain fallback when the source doesn't parse. Sending the same title again grows the diagram in
// place: no view switch, and the new nodes flash in lime so the room sees what was added.
import { mountView, make, clip } from "./mount.js";

const BOX = { w: 1090, h: 455 }; // the stage minus padding, title and caption room
const MAX_UPSCALE = 1.5;
let mermaidLib;
let last = { title: "", labels: new Set() };

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function lib() {
  if (mermaidLib) return mermaidLib;
  mermaidLib = (await import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")).default;
  const blue = token("--cue-blue"), ink = token("--cue-ink"), paper = token("--cue-paper");
  const dim = token("--cue-paper-dim"), line = token("--cue-line"), lime = token("--cue-lime"), muted = token("--cue-ink-muted");
  const font = `${token("--cue-font-body")}`;
  // Timelines and mindmaps color each section from cScale0..11; keep those on paper, alternating tints.
  const scale = {};
  for (let i = 0; i < 12; i++) {
    scale[`cScale${i}`] = i % 2 ? dim : "#ffffff";
    scale[`cScaleLabel${i}`] = ink;
    scale[`cScaleInv${i}`] = blue;
  }
  mermaidLib.initialize({
    startOnLoad: false, securityLevel: "strict", theme: "base",
    fontFamily: font,
    themeVariables: {
      background: "#ffffff", fontFamily: font, fontSize: "22px",
      primaryColor: paper, primaryTextColor: ink, primaryBorderColor: blue,
      secondaryColor: dim, secondaryTextColor: ink, secondaryBorderColor: blue,
      tertiaryColor: "#ffffff", tertiaryTextColor: ink, tertiaryBorderColor: line,
      lineColor: blue, textColor: ink, titleColor: ink, edgeLabelBackground: lime,
      clusterBkg: dim, clusterBorder: line, nodeTextColor: ink,
      actorBkg: paper, actorBorder: blue, actorTextColor: ink, actorLineColor: muted,
      signalColor: blue, signalTextColor: ink, labelBoxBkgColor: dim, labelBoxBorderColor: blue,
      labelTextColor: ink, loopTextColor: ink, noteBkgColor: lime, noteTextColor: ink, noteBorderColor: lime,
      activationBkgColor: dim, activationBorderColor: blue, sequenceNumberColor: paper,
      git0: blue, pie1: blue, pie2: lime, pie3: muted, pie4: dim,
      ...scale,
    },
    flowchart: { useMaxWidth: false, padding: 14, nodeSpacing: 36, rankSpacing: 40, htmlLabels: true },
    sequence: { useMaxWidth: false, actorFontSize: 22, messageFontSize: 22, noteFontSize: 20, boxMargin: 12, mirrorActors: false },
    timeline: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    er: { useMaxWidth: false }, gantt: { useMaxWidth: false }, state: { useMaxWidth: false }, class: { useMaxWidth: false },
  });
  return mermaidLib;
}

// The model often forgets to quote labels with punctuation: A[Events (web, app)]. Quote them.
function repair(src) {
  return src.replace(/(\w)\[([^\]"\n]+)\]/g, (m, id, label) =>
    /^[([/\\]/.test(label) || !/[(){}:;,&#]/.test(label) ? m : `${id}["${label}"]`);
}

// Our title is above the diagram, so a timeline's own title line would repeat it.
const tidy = (src) => src.replace(/^\s*title\s.*$/m, (l) => (/^\s*(timeline|journey)/.test(src) ? "" : l));

const flip = (src) => {
  const m = src.match(/^(\s*(?:flowchart|graph))\s+(LR|RL|TD|TB|BT)\b/);
  if (!m) return null;
  return src.replace(m[0], `${m[1]} ${/^(LR|RL)$/.test(m[2]) ? "TD" : "LR"}`);
};

async function render(src) {
  const m = await lib();
  const { svg } = await m.render(`cue-d${Date.now()}${Math.floor(Math.random() * 1e4)}`, src);
  const holder = document.createElement("div");
  holder.innerHTML = svg; // Mermaid's own output, rendered with securityLevel strict
  const el = holder.firstElementChild;
  const vb = el.viewBox.baseVal;
  const w = vb?.width || el.getBBox?.().width || BOX.w, h = vb?.height || BOX.h;
  return { el, w, h, scale: Math.min(BOX.w / w, BOX.h / h, MAX_UPSCALE) };
}

const labelsOf = (svg) => new Set([...svg.querySelectorAll(".node, .actor, .timeline-node, .section, .mindmap-node")]
  .map((n) => n.textContent.replace(/\s+/g, " ").trim()).filter(Boolean));

/** @param {{title: string, mermaid: string}} input */
export async function showDiagram(input, view) {
  const el = await mountView("diagram", `<h1></h1><div class="diagram-box"></div>`);
  el.classList.add("sheet");
  const title = clip(input.title, 70);
  const source = String(input.mermaid || "");
  const box = el.querySelector(".diagram-box");
  const growing = view.mode() === "diagram" && title.toLowerCase() === last.title.toLowerCase();

  let out = null, error = "";
  for (const src of [tidy(source), tidy(repair(source))]) {
    try { out = await render(src); break; } catch (err) { error ||= String(err.message || err).split("\n")[0]; }
  }
  // A wide left-to-right flowchart shrinks below readable; top-to-bottom often fits bigger, and back.
  if (out && out.scale < 0.9) {
    const alt = flip(tidy(repair(source)));
    if (alt) try { const o = await render(alt); if (o.scale > out.scale * 1.1) out = o; } catch {}
  }

  el.querySelector("h1").textContent = title;
  if (out) {
    out.el.setAttribute("width", String(Math.round(out.w * out.scale)));
    out.el.setAttribute("height", String(Math.round(out.h * out.scale)));
    out.el.style.maxWidth = "none";
    const labels = labelsOf(out.el);
    if (growing) {
      for (const n of out.el.querySelectorAll(".node, .actor, .timeline-node, .mindmap-node")) {
        if (!last.labels.has(n.textContent.replace(/\s+/g, " ").trim())) n.classList.add("cue-new");
      }
    }
    box.classList.remove("fallback");
    box.replaceChildren(out.el);
    last = { title, labels };
  } else {
    // Parse failed even after repair: show the labels it named, in order, as a plain flow.
    const seen = new Set();
    const names = [...source.matchAll(/["[({]+([^"\])}\n]{2,60})[\])}"]+|:\s*([^:\n]{2,60})$/gm)]
      .map((m) => clip(m[1] || m[2], 40)).filter((s) => s && !seen.has(s) && seen.add(s)).slice(0, 8);
    box.classList.add("fallback");
    box.replaceChildren(...names.flatMap((n, i) => (i ? [make("span", "arrow", "→"), make("span", "chip", n)] : [make("span", "chip", n)])));
    last = { title, labels: new Set() };
    view.remember(`diagram failed to draw (${clip(error, 100)}); showed its labels instead`);
  }
  if (!growing) view.show("diagram");
  view.screen({ mode: "diagram", title, mermaid: source });
  view.remember(`${growing ? "diagram updated" : "diagram"}: ${title}`);
}
