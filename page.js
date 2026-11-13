// A web page reduced to its readable text, split into paragraphs. /api/page
// serves it to the research view, which highlights quotes in it; the replay
// (evals/replay.mjs) uses it to check that those quotes can be found.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export async function fetchReadable(target) {
  const r = await fetch(target, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Cue/0.1)" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const html = await r.text();
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();
  const text = (article?.textContent || document.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url: r.url,
    title: article?.title || document.title || target,
    site: article?.siteName || new URL(r.url).hostname,
    paragraphs: text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0)
      .slice(0, 400),
  };
}
