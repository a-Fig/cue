// A real picture (#61): Claude names what it wants a picture of, and the server finds a freely
// licensed one (image.js: Wikimedia Commons, then Openverse) and serves it from this origin. The
// page asks only its own server, so it never loads a host a web page steered Claude towards. The
// credit is shown small, as the licences ask.
import { mountView, make, clip } from "./mount.js";

let gen = 0; // a newer show_image wins over an older one still searching

/** @param {{query: string, title: string}} input @param {{token: string}} view */
export async function showImage(input, view) {
  const mine = ++gen;
  const query = clip(input.query, 100);
  const tok = `token=${encodeURIComponent(view.token)}`;
  let found;
  try {
    const r = await fetch(`/api/image?${tok}&q=${encodeURIComponent(query)}`);
    found = await r.json();
    if (!r.ok) throw new Error(found.error || r.status);
  } catch (e) {
    return console.log("[cue] show_image found nothing:", e.message);
  }
  const img = new Image();
  img.src = `${found.src}&${tok}`;
  try { await img.decode(); } catch { return console.log("[cue] show_image: the picture didn't load"); }
  if (mine !== gen) return;

  const el = await mountView("image", `<h1></h1><div class="image-box"></div><p class="credit"></p>`);
  const title = clip(input.title, 70);
  el.querySelector("h1").textContent = title;
  el.classList.toggle("untitled", !title);
  img.alt = title || found.title;
  el.querySelector(".image-box").replaceChildren(img);
  const credit = [found.credit, found.license, found.source].filter(Boolean).join(" · ");
  el.querySelector(".credit").replaceChildren(make("span", "", credit));
  view.show("image");
  view.screen({ mode: "image", title, query, credit });
  view.remember(`image: ${title} (${query})`);
}
