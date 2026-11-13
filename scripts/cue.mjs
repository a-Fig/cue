// Put Cue in a meeting with one command, and take it out again.
//   npm run cue -- <meeting-url>
//
// Starts the server unless one is already running on PORT. Uses PUBLIC_URL when it serves
// Cue's page; otherwise opens a cloudflared quick tunnel, whose address changes every run.
// Then it sends the bot and reports what it does. The bot leaves on Ctrl+C, after
// CUE_MAX_MINUTES (60 by default), or on its own once everyone else has left the call
// (Recall's default). A bot left behind keeps billing, so if this process is killed hard,
// remove it from Recall's dashboard.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBot, getBot, leaveCall } from "./recall.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const meetingUrl = process.argv[2];
const PORT = Number(process.env.PORT || 3000);
const MAX_MINUTES = Number(process.env.CUE_MAX_MINUTES || 60);
const local = `http://localhost:${PORT}`;

if (!meetingUrl || !/^https?:\/\//.test(meetingUrl)) {
  console.error("usage: npm run cue -- <meeting-url>   (e.g. https://meet.google.com/abc-defg-hij)");
  process.exit(1);
}

const children = [];
const say = (msg) => console.log(`[cue] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Does this address serve Cue's page? (A stale tunnel address may serve something else.)
async function servesCue(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return r.ok && (await r.text()).includes("<title>Cue</title>");
  } catch {
    return false;
  }
}

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await servesCue(url)) return true;
    await sleep(1000);
  }
  return false;
}

async function startServer() {
  if (await servesCue(local)) return say(`using the server already running at ${local}`);
  const server = spawn(process.execPath, ["server.js"], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "inherit"] });
  children.push(server);
  // Pass through the server's think lines, so the terminal shows what Cue decides.
  server.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => console.log(`  ${l}`)));
  if (!(await waitFor(local, 15))) throw new Error(`the server didn't come up on ${local}`);
  say(`server started at ${local}`);
}

async function publicUrl() {
  const configured = process.env.PUBLIC_URL;
  if (configured && (await servesCue(configured))) {
    say(`using PUBLIC_URL ${configured}`);
    return configured;
  }
  say("opening a cloudflared tunnel…");
  const tunnel = spawn("cloudflared", ["tunnel", "--url", local], { stdio: ["ignore", "ignore", "pipe"] });
  children.push(tunnel);
  const url = await new Promise((resolve, reject) => {
    tunnel.on("error", () => reject(new Error("cloudflared isn't installed (winget install Cloudflare.cloudflared)")));
    tunnel.on("exit", (code) => reject(new Error(`cloudflared exited (${code})`)));
    tunnel.stderr.on("data", (d) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) resolve(m[0]);
    });
  });
  // A new quick-tunnel name takes a few seconds to resolve.
  if (!(await waitFor(url, 60))) throw new Error(`the tunnel ${url} never served the page`);
  say(`public at ${url}`);
  return url;
}

// What Recall's status codes mean for the person at the terminal.
const STATUS = {
  joining_call: "joining the call…",
  in_waiting_room: "in the lobby: admit Cue from the meeting",
  in_call_not_recording: "in the call",
  in_call_recording: "in the call and listening",
  call_ended: "the call ended",
  done: "left the call",
  fatal: "failed",
};

let botId;
let leaving = false;
async function leave(why) {
  if (leaving) return;
  leaving = true;
  say(`${why}: taking Cue out of the call…`);
  try {
    if (botId) await leaveCall(botId);
  } catch (err) {
    // Already gone, most often. Anything else: the bot may still be billing.
    say(`couldn't remove the bot (${err.message}); check Recall's dashboard`);
  }
}

function shutdown(code) {
  for (const c of children) c.kill();
  process.exit(code);
}

let interrupts = 0;
process.on("SIGINT", async () => {
  if (++interrupts > 1) shutdown(130); // second Ctrl+C: stop without waiting
  await leave("Ctrl+C");
});

try {
  await startServer();
  const url = await publicUrl();
  const bot = await createBot(meetingUrl, url);
  botId = bot.id;
  say(`bot ${botId} sent to ${meetingUrl}. It leaves after ${MAX_MINUTES} min, or on Ctrl+C.`);
  setTimeout(() => leave(`${MAX_MINUTES} minutes are up`), MAX_MINUTES * 60_000).unref();

  let last = "";
  for (;;) {
    await sleep(3000);
    const changes = (await getBot(botId).catch(() => ({}))).status_changes || [];
    const now = changes.at(-1);
    if (!now || now.code === last) continue;
    last = now.code;
    say((STATUS[now.code] || now.code) + (now.sub_code ? ` (${now.sub_code})` : ""));
    if (now.code === "done" || now.code === "fatal") break;
  }
  shutdown(0);
} catch (err) {
  say(err.message);
  if (botId) await leave("error");
  shutdown(1);
}
