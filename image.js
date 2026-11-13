// Pictures for show_image (#61): Claude names what it wants a picture of, and the server finds a
// freely licensed one. The page never loads an image host it was steered to: /api/image returns a
// path on this server, and /api/image/raw serves only images this module found in the last hour,
// fetched through page.js's per-hop address checks, capped in size, and only as bitmap types
// (an SVG served from Cue's own origin could run script if someone opened it directly).
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
const vetted = new Map(); // image URL -> time found

const strip = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

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
    iiextmetadatafilter: "Artist|LicenseShortName|ObjectName",
  });
  const pages = (await getJson(u)).query?.pages || [];
  return pages.sort((a, b) => a.index - b.index).map((p) => {
    const ii = p.imageinfo?.[0] || {};
    const m = ii.extmetadata || {};
    return {
      url: ii.thumburl || ii.url, width: ii.thumbwidth, height: ii.thumbheight, mime: ii.mime,
      title: strip(m.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
      credit: strip(m.Artist?.value), license: strip(m.LicenseShortName?.value), source: "Wikimedia Commons",
    };
  });
}

async function openverse(q) {
  const u = new URL("https://api.openverse.org/v1/images/");
  u.search = new URLSearchParams({ q, page_size: "8", mature: "false" });
  return ((await getJson(u)).results || []).map((r) => ({
    url: r.url, width: r.width, height: r.height, title: r.title || q,
    credit: r.creator || "", license: [r.license?.toUpperCase(), r.license_version].filter(Boolean).join(" "), source: "Openverse",
  }));
}

const SOURCES = [commons, openverse];

// The screen is 16:9, so a landscape picture fills it best; among the first few results, take the
// first wide one, else the first.
function pick(cands) {
  const ok = cands.filter((c) => c.url && isPublicHttpUrl(c.url) && (!c.mime || TYPES.has(c.mime)));
  return ok.slice(0, 5).find((c) => c.width && c.height && c.width >= c.height * 1.1) || ok[0];
}

export async function findImage(query) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) throw new Error("no query");
  const errors = [];
  for (const source of SOURCES) {
    try {
      const c = pick(await source(q));
      if (!c) continue;
      vetted.set(c.url, Date.now());
      for (const [u, t] of vetted) if (Date.now() - t > TTL_MS) vetted.delete(u);
      return { src: `/api/image/raw?u=${encodeURIComponent(c.url)}`, title: c.title.slice(0, 120), credit: c.credit.slice(0, 80), license: c.license.slice(0, 40), source: c.source };
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(errors.length ? `no image: ${errors.join("; ")}` : "no image found");
}

/** @returns {Promise<{type: string, body: Buffer}>} only for an image findImage returned */
export async function fetchVettedImage(url) {
  const t = vetted.get(url);
  if (!t || Date.now() - t > TTL_MS) throw Object.assign(new Error("not a vetted image"), { status: 403 });
  const { r } = await fetchPublic(url, AbortSignal.timeout(10_000), { "user-agent": UA });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
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
