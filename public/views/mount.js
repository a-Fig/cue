// Shared by the view modules in this folder: each view adds its own <section class="view"> to the
// stage and its own stylesheet the first time it is used, so new views don't touch index.html or
// style.css (those belong to the shared rendering work, #18's agreed split).
// Resolves once the view's stylesheet has loaded, so a view can measure itself to fit.
const mounted = new Map();
export function mountView(name, html) {
  if (!mounted.has(name)) mounted.set(name, mount(name, html));
  return mounted.get(name);
}

async function mount(name, html) {
  const css = document.createElement("link");
  const loaded = new Promise((res) => { css.onload = css.onerror = res; });
  css.rel = "stylesheet";
  css.href = new URL(`./${name}.css`, import.meta.url).href;
  document.head.append(css);
  const el = document.createElement("section");
  el.className = `view ${name}`;
  el.id = `view-${name}`;
  el.innerHTML = html; // fixed markup from the module, never model text
  const before = document.getElementById("cover"); // stay under the screen cover and caption
  document.getElementById("stage").insertBefore(el, before);
  await loaded;
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
