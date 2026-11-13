// Tiny server: serves the agent page and two endpoints.
//   POST /api/think   transcript in, display actions out (calls Claude)
//   GET  /api/page    fetches a web page and returns its readable text,
//                     so the page can render it with highlights
//   GET  /api/image   finds a freely licensed picture for a query (image.js)
//   GET  /api/image/raw  serves a picture /api/image fetched, so the page loads
//                     images only from this server
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { think } from "./agent.js";
import { fetchReadable, isPublicHttpUrl } from "./page.js";
import { findImage, keptImage } from "./image.js";

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
        addressed: body.addressed === true,
      });
      const u = result.usage;
      const g = result.gate;
      console.log(`think ${Date.now() - started}ms $${u.usd.toFixed(4)}` +
        (g ? ` [system 1 jev ${g.error ? "error" : g.act ? "act" : "quiet"} ${g.ms}ms]` : "") +
        ` (in ${u.input + u.cacheRead + u.cacheWrite}, ` +
        `cached ${u.cacheRead}, out ${u.output}, searches ${u.searches}, fetches ${u.fetches}) ->`,
        result.actions.map((a) => a.tool).join(", ") || "quiet");
      return send(res, 200, result);
    }

    if (url.pathname === "/api/page" && req.method === "GET") {
      if (!authorized(url, req)) return send(res, 401, { error: "bad token" });
      const target = url.searchParams.get("url") || "";
      if (!isPublicHttpUrl(target)) return send(res, 400, { error: "url not allowed" });
      return send(res, 200, await fetchReadable(target));
    }

    if (url.pathname === "/api/image" && req.method === "GET") {
      if (!authorized(url, req)) return send(res, 401, { error: "bad token" });
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return send(res, 400, { error: "q required" });
      try {
        return send(res, 200, await findImage(q));
      } catch (e) {
        return send(res, 404, { error: e.message });
      }
    }

    // Serves only pictures /api/image fetched and kept (image.js); it fetches nothing itself.
    if (url.pathname === "/api/image/raw" && req.method === "GET") {
      if (!authorized(url, req)) return send(res, 401, { error: "bad token" });
      try {
        const { type, body } = keptImage(url.searchParams.get("id") || "");
        res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
        return res.end(body);
      } catch (e) {
        return send(res, e.status || 502, { error: e.message });
      }
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
