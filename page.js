// A web page reduced to its readable text, split into paragraphs. /api/page
// serves it to the research view, which highlights quotes in it; the replay
// (evals/replay.mjs) uses it to check that those quotes can be found.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import net from "node:net";

// Refuse obvious internal addresses so /api/page can't be used to probe
// the network the server runs on, on the first hop and every redirect.
// (Doesn't stop DNS tricks; fine for a demo.)
export function isPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  // A trailing dot ("localhost.") is the same name to a resolver.
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal)$/.test(host)) return false;
  if (net.isIP(host)) {
    return !/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|::ffff:|f[cd]|fe80)/i.test(host);
  }
  return true;
}

const MAX_HTML = 5_000_000; // bytes; a page bigger than this isn't an article

// Follows redirects by hand so every hop gets the same address check: with
// redirect: "follow", a public URL could bounce the server to 127.0.0.1 or a
// cloud metadata address (#14).
export async function fetchPublic(target, signal, headers = {}) {
  let url = target;
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicHttpUrl(url)) throw new Error("redirect to a url that isn't allowed");
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Cue/0.1)", ...headers },
      redirect: "manual",
      signal,
    });
    const next = r.status >= 300 && r.status < 400 && r.headers.get("location");
    if (!next) return { r, url };
    await r.body?.cancel(); // free the connection; a redirect's body is never read
    url = new URL(next, url).toString();
  }
  throw new Error("too many redirects");
}

async function readCapped(r) {
  if (Number(r.headers.get("content-length")) > MAX_HTML) throw new Error("page too large");
  if (!r.body) return "";
  const chunks = [];
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > MAX_HTML) throw new Error("page too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchReadable(target) {
  const { r, url: finalUrl } = await fetchPublic(target, AbortSignal.timeout(10_000));
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const html = await readCapped(r);
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();
  const text = (article?.textContent || document.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url: finalUrl,
    title: article?.title || document.title || target,
    site: article?.siteName || new URL(finalUrl).hostname,
    paragraphs: text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0)
      .slice(0, 400),
  };
}
