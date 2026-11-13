// Cleans SVG or HTML that Claude wrote for show_visual (#61). Model output can be shaped by the web
// pages it read (#14), so it is treated as hostile: an allowlist of drawing and text elements, no
// event handlers, and no URL that leaves the document (only "#id" references survive). The result
// is then shown in an iframe sandboxed without scripts, under a CSP that loads nothing but the
// brand's fonts (visual.js), so a gap here still can't run code or call out.
// Pure: it takes a DOMParser, so the CI check can run it under linkedom.

const SVG_TAGS = [
  "svg", "g", "defs", "symbol", "use", "title", "desc", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "textpath", "lineargradient", "radialgradient", "stop",
  "clippath", "mask", "pattern", "marker", "filter", "fegaussianblur", "fedropshadow", "feoffset",
  "feflood", "fecomposite", "femerge", "femergenode", "fecolormatrix", "feblend",
  "animate", "animatetransform",
];
const HTML_TAGS = [
  "div", "span", "p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "table", "thead", "tbody", "tr",
  "th", "td", "strong", "em", "b", "i", "small", "sup", "sub", "br", "hr", "figure", "figcaption",
  "section", "header", "footer", "style",
];
const ALLOWED = new Set([...SVG_TAGS, ...HTML_TAGS]);
// Attributes that hold a URL. Only a same-document reference ("#grad1") is kept.
const URL_ATTRS = new Set(["href", "xlink:href", "src", "srcset", "action", "formaction", "background", "poster", "data", "ping"]);
const MAX_CHARS = 40_000;

// url(#id) stays (gradients, clip paths, markers); any other url(), image-set(), @import and CSS
// escapes go, since escapes can spell "url" past the pattern. "<" goes too: a style element's text
// is written back out raw, so "</style><script>" in it would end the element on the next parse.
export function cleanCss(css) {
  return String(css)
    .replace(/[\\<]/g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\(\s*(?!['"]?\s*#)[^)]*\)/gi, "none")
    .replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(");
}

function cleanTree(parent) {
  for (const el of [...parent.children]) {
    const tag = el.localName.toLowerCase();
    if (!ALLOWED.has(tag)) { el.remove(); continue; }
    // <animate attributeName="href" to="javascript:…"> would rewrite a reference after cleaning.
    if (tag.startsWith("animate") && /href/i.test(el.getAttribute("attributeName") || "")) { el.remove(); continue; }
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase();
      const v = value.trim();
      if (n.startsWith("on") || /javascript:|data:/i.test(v)
          || (URL_ATTRS.has(n) && !v.startsWith("#"))
          || (/url\s*\(/i.test(v) && cleanCss(v) !== v)) {
        el.removeAttribute(name);
      } else if (n === "style") {
        el.setAttribute(name, cleanCss(v));
      }
    }
    if (tag === "style") el.textContent = cleanCss(el.textContent);
    else cleanTree(el);
  }
}

/**
 * @param {string} markup SVG or an HTML fragment
 * @param {DOMParser} parser
 * @returns {{html: string, kind: "svg"|"html"}} html is "" when nothing drawable is left
 */
export function sanitizeMarkup(markup, parser) {
  const src = String(markup || "").slice(0, MAX_CHARS).replace(/<\?xml[^>]*\?>/i, "");
  // The HTML parser is lenient and parses inline <svg> into the SVG namespace, so one path covers
  // both. A parsed document is inert: nothing in it loads or runs.
  const doc = parser.parseFromString(`<!doctype html><html><body>${src}</body></html>`, "text/html");
  cleanTree(doc.body);
  const kids = [...doc.body.children];
  const kind = kids.length === 1 && kids[0].localName.toLowerCase() === "svg" ? "svg" : "html";
  if (kind === "svg") {
    const svg = kids[0];
    // Without a viewBox the drawing can't scale to the frame; derive one from width and height.
    const w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height"));
    if (!svg.getAttribute("viewBox") && w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
  }
  const html = doc.body.innerHTML.trim();
  const drawn = doc.body.textContent.trim() || [...doc.body.querySelectorAll("*")].some((e) => e.localName.toLowerCase() !== "style");
  return { html: drawn ? html : "", kind };
}
