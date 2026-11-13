// Shared by the view modules in this folder: each view adds its own <section class="view"> to the
// stage and its own stylesheet the first time it is used, so new views don't touch index.html or
// style.css (those belong to the shared rendering work, #18's agreed split).
export function mountView(name, html) {
  let el = document.getElementById(`view-${name}`);
  if (el) return el;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL(`./${name}.css`, import.meta.url).href;
  document.head.append(css);
  el = document.createElement("section");
  el.className = `view ${name}`;
  el.id = `view-${name}`;
  el.innerHTML = html; // fixed markup from the module, never model text
  const before = document.getElementById("cover"); // stay under the screen cover and caption
  document.getElementById("stage").insertBefore(el, before);
  return el;
}

export const make = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = String(text);
  return el;
};

export const clip = (s, n) => {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
};
