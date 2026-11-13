// Part of `npm run check`: the show_visual sanitizer (public/views/sanitize.js) against markup a
// prompt-injected model might write (#61, #14). Showing the result as an SVG image (which can't
// run scripts or load anything) is the second layer; these cases are the first.
import { DOMParser } from "linkedom";
import { sanitizeMarkup } from "../public/views/sanitize.js";

const parser = new DOMParser();
const clean = (m) => sanitizeMarkup(m, parser).html;
const cases = [
  ["keeps a plain chart", `<svg viewBox="0 0 10 10"><rect x="1" width="3" height="5" fill="#3168b0"/><text x="1" y="9">Q3</text></svg>`,
    (h) => h.includes("<rect") && h.includes("Q3")],
  ["drops script", `<svg viewBox="0 0 10 10"><script>alert(1)</script><text>hi</text></svg>`, (h) => !/script|alert/i.test(h)],
  ["drops event handlers", `<svg viewBox="0 0 10 10" onload="x()"><rect onclick="y()" width="1" height="1"/></svg>`, (h) => !/onload|onclick/i.test(h)],
  ["drops foreignObject", `<svg viewBox="0 0 10 10"><foreignObject><div>x</div><iframe src="https://e.com"></iframe></foreignObject><text>t</text></svg>`,
    (h) => !/foreignobject|iframe|e\.com/i.test(h)],
  ["drops external href", `<svg viewBox="0 0 10 10"><use href="https://evil.example/s.svg#a"/><use xlink:href="javascript:x"/><use href="#a"/></svg>`,
    (h) => !/evil|javascript/i.test(h) && h.includes('href="#a"')],
  ["drops images and links", `<svg viewBox="0 0 10 10"><image href="https://e.com/a.png"/><a href="https://e.com"><text>t</text></a></svg>`,
    (h) => !/<image|<a |e\.com/i.test(h)],
  ["drops external url() but keeps url(#id)", `<svg viewBox="0 0 10 10"><rect fill="url(#g)" style="fill:url(https://e.com/x)" stroke="url(https://e.com/y)" width="1" height="1"/></svg>`,
    (h) => h.includes('fill="url(#g)"') && !/e\.com/.test(h)],
  ["cleans style elements", String.raw`<style>@import url(https://e.com/a.css); .a{background:url("https://e.com/b")} .b{background:u\72l(https://e.com/c)}</style><div class="a">x</div>`,
    // An escape left as "u72l(" once the backslash goes is no longer a URL.
    (h) => !/url\(\s*['"]?https|@import/.test(h) && h.includes("background:none")],
  ["style can't break out", `<style>.a{}</style><script>alert(1)</script></style><div>x</div>`, (h) => !/<script/i.test(h)],
  ["drops animate on href", `<svg viewBox="0 0 10 10"><use href="#a"><set attributeName="href" to="javascript:x"/><animate attributeName="href" values="javascript:x"/></use></svg>`,
    (h) => !/javascript|<set|<animate/i.test(h)],
  ["drops meta, base, link, form", `<meta http-equiv="refresh" content="0;url=https://e.com"><base href="https://e.com/"><link rel="stylesheet" href="https://e.com/c.css"><form action="https://e.com"><input></form><p>ok</p>`,
    (h) => !/e\.com|<meta|<base|<link|<form|<input/i.test(h) && h.includes("ok")],
  ["drops data: urls", `<div style="background:url(data:image/svg+xml,x)">x</div><svg viewBox="0 0 1 1"><use href="data:image/svg+xml,x"/></svg>`, (h) => !/data:/i.test(h)],
  ["gives a viewBox from width and height", `<svg width="400" height="200"><rect width="1" height="1"/></svg>`, (h) => h.includes('viewBox="0 0 400 200"') && !/width="400"/.test(h)],
  ["no viewBox from percentages", `<svg width="100%" height="100%"><rect width="1" height="1"/></svg>`, (h) => !/viewBox/.test(h)],
  ["sizes an svg inside HTML too", `<style>.a{}</style><svg width="1136" height="470px"><rect width="1" height="1"/></svg>`, (h) => h.includes('viewBox="0 0 1136 470"')],
  ["keeps harmless text that says data:", `<svg viewBox="0 0 1 1" aria-label="Revenue data: Q3"><rect width="1" height="1"/></svg>`, (h) => h.includes("Revenue data")],
  ["caps <use> copies", `<svg viewBox="0 0 1 1"><g id="a"><rect width="1" height="1"/></g>${'<use href="#a"/>'.repeat(100)}</svg>`, (h) => (h.match(/<use/g) || []).length === 40],
  ["nothing drawable is empty", `<script>x</script>`, (h) => h === ""],
];

let failed = 0;
for (const [name, input, ok] of cases) {
  let out;
  try { out = clean(input); } catch (e) { out = `threw ${e.message}`; }
  const pass = ok(out);
  if (!pass) { failed++; console.log(`     got: ${out}`); }
  console.log(`${pass ? "ok  " : "FAIL"} sanitize: ${name}`);
}
export default failed;
