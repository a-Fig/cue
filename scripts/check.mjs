// The whole CI check, a few seconds long: every JS file parses, and the server
// boots, serves the page and guards its API. It never calls Claude or Recall,
// so it needs no keys.  Run it with `npm run check`.
import { execFileSync, spawn } from "node:child_process";
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

const checks = [
  ["page loads", "/?test=1", (r) => r.status === 200],
  ["script served as JS", "/app.js", (r) => r.status === 200 && r.headers.get("content-type").includes("javascript")],
  ["API needs the token", "/api/page?url=https://example.com", (r) => r.status === 401],
  ["internal URLs refused", "/api/page?token=ci-token&url=http://127.0.0.1:22", (r) => r.status === 400],
  ["no path traversal", "/..%2Fserver.js", (r) => r.status === 403 || r.status === 404],
];

let failed = 0;
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
} catch (e) {
  console.error(e.message);
  failed++;
} finally {
  server.kill();
}
process.exitCode = failed ? 1 : 0; // not process.exit(): exiting mid-kill trips a libuv assert on Windows
