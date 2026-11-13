// The whole CI check, a few seconds long: every JS file parses, the server
// boots, serves the page and guards its API, and the local panel refuses
// requests that don't come from its own page. It never calls Claude or Recall,
// so it needs no keys.  Run it with `npm run check`.
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", ".git"]);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(e.name)) files.push(p);
  }
})(root);

for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`syntax ok: ${files.length} files`);

const PORT = String(30000 + Math.floor(Math.random() * 20000));
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT, AGENT_TOKEN: "ci-token", ANTHROPIC_API_KEY: "unused" },
  stdio: ["ignore", "ignore", "inherit"],
});
const base = `http://127.0.0.1:${PORT}`;
const PANEL_PORT = String(Number(PORT) + 1);
const panel = spawn(process.execPath, ["scripts/panel.mjs"], {
  cwd: root,
  env: { ...process.env, PANEL_PORT, PORT, RECALL_API_KEY: "unused", RECALL_API: "http://127.0.0.1:9/" },
  stdio: ["ignore", "ignore", "inherit"],
});
const panelBase = `http://127.0.0.1:${PANEL_PORT}`;

const checks = [
  ["page loads", "/?test=1", (r) => r.status === 200],
  ["script served as JS", "/app.js", (r) => r.status === 200 && r.headers.get("content-type").includes("javascript")],
  ["API needs the token", "/api/page?url=https://example.com", (r) => r.status === 401],
  ["internal URLs refused", "/api/page?token=ci-token&url=http://127.0.0.1:22", (r) => r.status === 400],
  ["image search needs the token", "/api/image?q=bridge", (r) => r.status === 401],
  ["image proxy serves only kept images", "/api/image/raw?token=ci-token&id=1", (r) => r.status === 404],
  ["unsafe image queries refused", "/api/image?token=ci-token&q=nude%20beach", (r) => r.status === 404],
  ["no path traversal", "/..%2Fserver.js", (r) => r.status === 403 || r.status === 404],
];

let failed = (await import("./sanitize-check.mjs")).default;
try {
  for (let i = 0; ; i++) {
    try { await fetch(base); break; } catch { if (i > 50) throw new Error("server did not start"); }
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const [name, url, ok] of checks) {
    const r = await fetch(base + url);
    const pass = ok(r);
    if (!pass) failed++;
    console.log(`${pass ? "ok  " : "FAIL"} ${name} (${r.status})`);
  }

  for (let i = 0; ; i++) {
    try { await fetch(panelBase); break; } catch { if (i > 50) throw new Error("panel did not start"); }
    await new Promise((r) => setTimeout(r, 100));
  }
  // The panel can send bots, so only its own page may drive it. (Node's fetch can't set Host,
  // so the DNS-rebinding guard is checked with http.get.)
  const wrongHost = await new Promise((resolve, reject) =>
    http.get(`${panelBase}/api/state`, { headers: { host: `evil.example:${PANEL_PORT}` } }, (r) => { r.resume(); resolve(r); }).on("error", reject));
  const panelChecks = [
    ["panel page loads", await fetch(panelBase + "/"), (r) => r.status === 200],
    ["panel refuses a foreign Host", wrongHost, (r) => r.statusCode === 403],
    ["panel refuses a POST without its header", await fetch(panelBase + "/api/send", { method: "POST", body: "{}" }), (r) => r.status === 403],
    ["panel refuses a non-meeting link", await fetch(panelBase + "/api/send", { method: "POST", headers: { "x-cue-panel": "1" }, body: '{"meetingUrl":"nope"}' }), (r) => r.status === 400],
  ];
  for (const [name, r, ok] of panelChecks) {
    const pass = ok(r);
    if (!pass) failed++;
    console.log(`${pass ? "ok  " : "FAIL"} ${name} (${r.status ?? r.statusCode})`);
  }
} catch (e) {
  console.error(e.message);
  failed++;
} finally {
  server.kill();
  panel.kill();
}
process.exitCode = failed ? 1 : 0; // not process.exit(): exiting mid-kill trips a libuv assert on Windows
