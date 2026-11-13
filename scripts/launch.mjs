// Getting Cue into a call, shared by `npm run cue` (cue.mjs) and the local panel (panel.mjs):
// start the server, make it public, and follow the bot's status. Nothing here prints;
// each step reports through a `say` callback, so the terminal and the panel word it their way.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBot } from "./recall.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Does this address serve Cue's page? (A stale tunnel address may serve something else.)
export async function servesCue(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return r.ok && (await r.text()).includes("<title>Cue</title>");
  } catch {
    return false;
  }
}

export async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await servesCue(url)) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Start server.js on `port`, unless something there already serves Cue.
 * Returns the child process, or null when an existing server was reused.
 * `onLine` gets each line the server prints (its think lines); `onSpawn` gets the child as soon
 * as it exists, so a Ctrl+C during the wait can still stop it.
 */
export async function startServer({ port, say = () => {}, onLine, onSpawn }) {
  const local = `http://localhost:${port}`;
  if (await servesCue(local)) {
    say(`using the server already running at ${local}`);
    return null;
  }
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  onSpawn?.(server);
  server.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => onLine?.(l)));
  if (!(await waitFor(local, 15))) {
    server.kill();
    throw new Error(`the server didn't come up on ${local}`);
  }
  say(`server started at ${local}`);
  return server;
}

/**
 * Open a cloudflared quick tunnel to `target` (a local http address). Its public address
 * changes every run. Returns { url, child }; `child` must be killed to close the tunnel.
 */
export async function openTunnel(target, say = () => {}, onSpawn) {
  say("opening a cloudflared tunnel…");
  const child = spawn("cloudflared", ["tunnel", "--url", target], { stdio: ["ignore", "ignore", "pipe"] });
  onSpawn?.(child);
  try {
    const url = await new Promise((resolve, reject) => {
      child.on("error", () => reject(new Error("cloudflared isn't installed (winget install Cloudflare.cloudflared)")));
      child.on("exit", (code) => reject(new Error(`cloudflared exited (${code})`)));
      child.stderr.on("data", (d) => {
        const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) resolve(m[0]);
      });
    });
    // A new quick-tunnel name takes a few seconds to resolve.
    if (!(await waitFor(url, 60))) throw new Error(`the tunnel ${url} never served the page`);
    say(`public at ${url}`);
    return { url, child };
  } catch (err) {
    child.kill();
    throw err;
  }
}

/** PUBLIC_URL when it serves Cue's page, else a new quick tunnel to `target`. */
export async function publicUrl(target, say = () => {}, onSpawn) {
  const configured = process.env.PUBLIC_URL;
  if (configured && (await servesCue(configured))) {
    say(`using PUBLIC_URL ${configured}`);
    return { url: configured, child: null };
  }
  return openTunnel(target, say, onSpawn);
}

// What Recall's status codes mean for the person running Cue.
export const STATUS = {
  joining_call: "joining the call…",
  in_waiting_room: "in the lobby: admit Cue from the meeting",
  in_call_not_recording: "in the call",
  in_call_recording: "in the call and listening",
  call_ended: "the call ended",
  done: "left the call",
  fatal: "failed",
};

/**
 * Poll the bot every few seconds and call onStatus({ code, sub_code, created_at }) each time
 * its latest status changes. Resolves with the last status once the bot is done or failed,
 * or when `signal` aborts.
 */
export async function watchBot(botId, onStatus, { signal, every = 3000 } = {}) {
  let last;
  while (!signal?.aborted) {
    await sleep(every);
    const now = ((await getBot(botId).catch(() => ({}))).status_changes || []).at(-1);
    if (!now || now.code === last?.code) continue;
    last = now;
    onStatus(now);
    if (now.code === "done" || now.code === "fatal") break;
  }
  return last;
}
