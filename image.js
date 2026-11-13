// Pictures for show_image (#61): Claude names what it wants a picture of, and the server finds a
// freely licensed one. The page never loads an image host it was steered to: /api/image fetches
// the picture itself (page.js's per-hop address checks, a size cap, bitmap types only: an SVG
// served from Cue's own origin could run script if someone opened it directly), keeps the bytes
// for an hour, and returns a path on this server; /api/image/raw serves only those kept pictures.
//
// Sources are tried in order; each returns candidates {url, title, credit, license, source,
// width, height}. Wikimedia Commons and Openverse need no key and list reusable licences. Google
// Custom Search would slot in as another source, but needs a key and a search-engine ID, which is
// Tyler's call (#61), so it isn't here.
import { fetchPublic, isPublicHttpUrl } from "./page.js";

const UA = "Cue/0.1 (silent meeting assistant; hackathon demo)";
const MAX_BYTES = 8_000_000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TTL_MS = 60 * 60 * 1000;
const KEEP = 30; // pictures kept in memory
const kept = new Map(); // id -> {type, body, t}

// The whole room sees what Cue shows, and Commons has no safe-search: "breast" returned close-up
// nudity in its top results (Opus review, 2026-11-13). Refuse such queries, and skip any result
// whose title, description or tags have these words.
const UNSAFE = /\b(nude|nudity|naked|topless|breasts?|nipples?|genital\w*|penis|vagina|vulva|buttocks|sex|sexual|porn\w*|erotic\w*|fetish|lingerie|corpse|dead body|autopsy|gore|wounds?|surgery|surgical|beheading|lynching)\b/i;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

const strip = (html) => String(html || "").replace(/<[^>]*>/g, " ")
  .replace(/&#(x?)([0-9a-f]+);/gi, (_, x, n) => { try { return String.fromCodePoint(parseInt(n, x ? 16 : 10)); } catch { return " "; } })
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim();

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`);
  return r.json();
}

async function commons(q) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", generator: "search",
    gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "8",
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "1280",
    iiextmetadatafilter: "Artist|LicenseShortName|ObjectName|ImageDescription",
  });
  const pages = (await getJson(u)).query?.pages || [];
  return pages.sort((a, b) => a.index - b.index).map((p) => {
    const ii = p.imageinfo?.[0] || {};
    const m = ii.extmetadata || {};
    return {
      // The thumbnail is a JPEG or PNG even when the original is a TIFF; fetchImage checks the type.
      url: ii.thumburl || ii.url, width: ii.thumbwidth, height: ii.thumbheight,
      text: `${p.title} ${strip(m.ImageDescription?.value)}`,
      title: strip(m.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
      credit: strip(m.Artist?.value), license: strip(m.LicenseShortName?.value), source: "Wikimedia Commons",
    };
  });
}

async function openverse(q) {
  const u = new URL("https://api.openverse.org/v1/images/");
  // license_type=commercial: by default most results are non-commercial, which isn't "reusable".
  u.search = new URLSearchParams({ q, page_size: "8", mature: "false", license_type: "commercial" });
  const lic = (r) => {
    const l = String(r.license || "").toLowerCase();
    return l === "pdm" ? "Public domain" : l === "cc0" ? "CC0" : `CC ${l.toUpperCase()} ${r.license_version || ""}`.trim();
  };
  return ((await getJson(u)).results || []).map((r) => ({
    // Openverse's own thumbnail, not the original, which can be huge or an SVG on any host.
    url: r.thumbnail || r.url, width: r.width, height: r.height, title: r.title || q,
    text: `${r.title || ""} ${(r.tags || []).map((t) => t.name).join(" ")}`,
    credit: r.creator || "", license: lic(r), source: "Openverse",
  }));
}

const SOURCES = [commons, openverse];

// The screen is 16:9, so a wide picture fills it best, but relevance matters more: the first
// result stays first unless it is much taller than wide, and then a wide one (not a banner) among
// the next few goes ahead of it. "Taylor Swift" otherwise picked her logo over her portrait.
function order(cands) {
  const ok = cands.filter((c) => c.url && isPublicHttpUrl(c.url) && !UNSAFE.test(`${c.text || ""} ${c.title}`));
  const wide = (c) => c?.width && c.height && c.width >= c.height * 1.1 && c.width <= c.height * 2.2;
  const tall = (c) => c?.width && c.height && c.height > c.width * 1.4;
  const better = tall(ok[0]) && ok.slice(1, 5).find(wide);
  return better ? [better, ...ok.filter((c) => c !== better)] : ok;
}

async function fetchImage(url) {
  const { r } = await fetchPublic(url, AbortSignal.timeout(8000), { "user-agent": UA });
  if (!r.ok) { await r.body?.cancel(); throw new Error(`upstream ${r.status}`); }
  const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES.has(type)) { await r.body?.cancel(); throw new Error(`not a bitmap image: ${type}`); }
  if (Number(r.headers.get("content-length")) > MAX_BYTES) { await r.body?.cancel(); throw new Error("image too large"); }
  const chunks = [];
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("image too large");
    chunks.push(chunk);
  }
  return { type, body: Buffer.concat(chunks) };
}

let nextId = 1;
export async function findImage(query) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) throw new Error("no query");
  if (UNSAFE.test(q)) throw new Error("not a query Cue shows pictures for");
  const errors = [];
  for (const source of SOURCES) {
    let cands;
    try { cands = order(await source(q)); } catch (e) { errors.push(e.message); continue; }
    // A picked image can still fail (gone, too big, the wrong type): try the next couple.
    for (const c of cands.slice(0, 3)) {
      try {
        const img = await fetchImage(c.url);
        const id = String(nextId++);
        kept.set(id, { ...img, t: Date.now() });
        for (const [k, v] of kept) if (kept.size > KEEP || Date.now() - v.t > TTL_MS) kept.delete(k);
        return { src: `/api/image/raw?id=${id}`, title: cut(c.title, 120), credit: cut(c.credit, 80), license: cut(c.license, 40), source: c.source };
      } catch (e) {
        errors.push(e.message);
      }
    }
  }
  throw new Error(errors.length ? `no image: ${errors.join("; ")}` : "no image found");
}

/** @returns {{type: string, body: Buffer}} only for a picture findImage kept */
export function keptImage(id) {
  const img = kept.get(String(id));
  if (!img || Date.now() - img.t > TTL_MS) throw Object.assign(new Error("not a kept image"), { status: 404 });
  return img;
}
