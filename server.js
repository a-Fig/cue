// Tiny server: serves the agent page and two endpoints.
//   POST /api/think   transcript in, display actions out (calls Claude)
//   GET  /api/page    fetches a web page and returns its readable text,
//                     so the page can render it with highlights
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { think } from "./agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.AGENT_TOKEN || "";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function authorized(url, req) {
  if (!TOKEN) return true;
  return url.searchParams.get("token") === TOKEN || req.headers["x-agent-token"] === TOKEN;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("body too large");
  }
  return JSON.parse(raw || "{}");
}

// Refuse obvious internal addresses so /api/page can't be used to probe
// the network the server runs on. (Doesn't stop DNS tricks; fine for a demo.)
function isPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) {
    return !/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80)/i.test(host);
  }
  return true;
}

async function fetchReadable(target) {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/think" && req.method === "POST") {
      if (!authorized(url, req)) return send(res, 401, { error: "bad token" });
      const body = await readJson(req);
      const started = Date.now();
      const result = await think({
        transcript: (body.transcript || []).slice(-80),
        screen: body.screen,
        recentActions: (body.recentActions || []).slice(-6),
      });
      console.log(`think ${Date.now() - started}ms ->`, result.actions.map((a) => a.tool).join(", ") || "quiet");
      return send(res, 200, result);
    }

    if (url.pathname === "/api/page" && req.method === "GET") {
      if (!authorized(url, req)) return send(res, 401, { error: "bad token" });
      const target = url.searchParams.get("url") || "";
      if (!isPublicHttpUrl(target)) return send(res, 400, { error: "url not allowed" });
      return send(res, 200, await fetchReadable(target));
    }

    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, "forbidden", "text/plain");
      const data = await fs.readFile(file).catch(() => null);
      if (!data) return send(res, 404, "not found", "text/plain");
      return send(res, 200, data, TYPES[path.extname(file)] || "application/octet-stream");
    }

    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`cue on http://localhost:${PORT}/?test=1${TOKEN ? `&token=${TOKEN}` : ""}`);
});
