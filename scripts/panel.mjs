// A local web page for whoever runs Cue: paste a meeting link, send Cue in, watch it, take it out.
//   npm run panel        then open http://127.0.0.1:3900 (PANEL_PORT)
//
// It does what `npm run cue` does (launch.mjs), from buttons instead of a terminal.
//
// Why it is its own process, bound to 127.0.0.1: server.js is public over the tunnel, and a
// public "send bot" button would let anyone spend the Recall credit. The panel refuses any
// Host header but its own (so a DNS-rebinding page can't reach it) and any POST without its
// x-cue-panel header (so another tab's plain form post can't either).
//
// What Cue hears and does: the transcript lives in the bot's page, not in server.js, so the
// tunnel points at a small pass-through ("tap") that the panel runs on 127.0.0.1 in front of
// server.js. It forwards every request and response unchanged and keeps, in memory only, the
// transcript lines and actions of each POST /api/think. If the panel has to fall back to an
// existing PUBLIC_URL, think calls don't pass through it and the feed stays empty.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createBot, leaveCall } from "./recall.mjs";
import { STATUS, openTunnel, root, servesCue, startServer, watchBot } from "./launch.mjs";

const PANEL_PORT = Number(process.env.PANEL_PORT || 3900);
const PORT = Number(process.env.PORT || 3000);
const MAX_MINUTES = Number(process.env.CUE_MAX_MINUTES || 60);
const DOLLARS_PER_HOUR = 0.65; // Recall's rate, 2026-11-13; billed from joining until leaving
const PANEL_DIR = path.join(root, "panel");

// ---------- state the page polls ----------

const state = {
  phase: "idle", // idle | starting | joining | lobby | in_call | leaving | left | error
  phaseAt: {}, // when each phase began, for the panel's stepper
  message: "",
  meetingUrl: "",
  botId: "",
  publicUrl: "",
  sentAt: 0,
  endedAt: 0,
  maxMinutes: MAX_MINUTES,
  rate: DOLLARS_PER_HOUR,
  tapped: false, // do think calls pass through the tap?
  log: [], // { at, text }: what the panel did, in plain words
  feed: [], // { id, at, kind: "heard"|"did"|"quiet"|"failed", ... }
  screen: null, // what the bot's page says is on its screen, from its latest think call
};
let feedId = 0;

function setPhase(phase) {
  state.phase = phase;
  state.phaseAt[phase] ??= Date.now();
}

function step(text) {
  state.log.push({ at: Date.now(), text });
  state.log = state.log.slice(-50);
}
function feed(entry) {
  state.feed.push({ id: ++feedId, at: Date.now(), ...entry });
  state.feed = state.feed.slice(-300);
}

function problems() {
  const list = [];
  if (!process.env.RECALL_API_KEY) list.push({ level: "error", text: "RECALL_API_KEY isn't set in .env, so Cue can't join a call." });
  if (!process.env.AGENT_TOKEN) list.push({ level: "warn", text: "AGENT_TOKEN isn't set: anyone who finds the tunnel address can spend the Claude key." });
  if (!process.env.ANTHROPIC_API_KEY) list.push({ level: "warn", text: "ANTHROPIC_API_KEY isn't set. Cue can still think if `ant auth login` was run; otherwise it will stay quiet." });
  return list;
}

// ---------- the tap in front of server.js ----------

let lastHeard = null; // the last transcript line already in the feed
const key = (l) => `${l.speaker}\u0000${l.text}`;

// The page sends its last ~4 minutes of transcript on every call; only the lines after the
// last one we showed are new.
function newLines(transcript) {
  if (!Array.isArray(transcript) || !transcript.length) return [];
  const i = lastHeard ? transcript.map(key).lastIndexOf(lastHeard) : -1;
  lastHeard = key(transcript.at(-1));
  return transcript.slice(i + 1);
}

function recordThink(reqBody, status, resBody, ms) {
  let sent = {}, got = {};
  try { sent = JSON.parse(reqBody.toString("utf8") || "{}"); } catch {}
  try { got = JSON.parse(resBody.toString("utf8") || "{}"); } catch {}
  for (const l of newLines(sent.transcript)) feed({ kind: "heard", speaker: String(l.speaker || "Someone"), text: String(l.text || "") });
  if (sent.screen && typeof sent.screen === "object") state.screen = sent.screen;
  if (status !== 200) return feed({ kind: "failed", ms, text: String(got.error || `status ${status}`) });
  const actions = Array.isArray(got.actions) ? got.actions : [];
  if (!actions.length) return feed({ kind: "quiet", ms });
  feed({ kind: "did", ms, actions: actions.map((a) => ({ tool: String(a.tool), input: a.input ?? {} })) });
  // Until the page's next think call says what it shows, assume the last view it was told to show.
  for (const { tool, input = {} } of actions) {
    const mode = { show_slide: "slide", show_diagram: "diagram", show_research: "research", play_video: "video" }[tool];
    if (mode) state.screen = { ...state.screen, mode, title: input.title, url: input.url, bullets: input.bullets };
    if (tool === "stop_video") state.screen = { ...state.screen, mode: "idle" };
  }
}

function startTap() {
  const tap = http.createServer((req, res) => {
    const think = req.method === "POST" && req.url.split("?")[0] === "/api/think";
    const started = Date.now();
    const reqChunks = [];
    const up = http.request(
      { host: "localhost", port: PORT, method: req.method, path: req.url, headers: req.headers },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.statusMessage, upRes.rawHeaders);
        const resChunks = [];
        upRes.on("data", (c) => { if (think) resChunks.push(c); });
        upRes.on("end", () => {
          if (think) recordThink(Buffer.concat(reqChunks), upRes.statusCode, Buffer.concat(resChunks), Date.now() - started);
        });
        upRes.pipe(res);
      },
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("Cue's server isn't answering");
    });
    if (think) req.on("data", (c) => { if (reqChunks.length < 1000) reqChunks.push(c); });
    req.pipe(up);
  });
  return new Promise((resolve) => tap.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${tap.address().port}`)));
}

// ---------- sending the bot, watching it, taking it out ----------

const children = { server: null, tunnel: null };
let tapUrl = "";
let watch = null; // AbortController for the current bot's status loop
let maxTimer = null;

const PHASE = { joining_call: "joining", in_waiting_room: "lobby", in_call_not_recording: "in_call", in_call_recording: "in_call", call_ended: "leaving", done: "left", fatal: "error" };

// The server and tunnel stay up between bots, so a second send is quick.
async function ensurePublic() {
  if (!children.server) {
    children.server = await startServer({ port: PORT, say: step }); // null: one was already running
    children.server?.on("exit", () => { children.server = null; });
  }
  if (state.publicUrl && (await servesCue(state.publicUrl))) return state.publicUrl;
  children.tunnel?.kill();
  children.tunnel = null;
  try {
    const t = await openTunnel(tapUrl, step);
    children.tunnel = t.child;
    t.child.on("exit", () => { if (children.tunnel === t.child) { children.tunnel = null; state.publicUrl = ""; } });
    state.tapped = true;
    return (state.publicUrl = t.url);
  } catch (err) {
    const configured = process.env.PUBLIC_URL;
    if (configured && (await servesCue(configured))) {
      step(`${err.message}; using PUBLIC_URL ${configured} instead (the live feed stays empty)`);
      state.tapped = false;
      return (state.publicUrl = configured);
    }
    throw err;
  }
}

// "Recall returned 400: {"meeting_url":["not a supported meeting"]}" → something a person reads.
function plainRecallError(err) {
  const m = /^Recall returned (\d+): (.*)$/s.exec(err.message);
  if (!m) return err.message;
  let detail = m[2];
  try {
    const body = JSON.parse(m[2]);
    detail = Object.entries(body).map(([k, v]) => `${k.replaceAll("_", " ")}: ${[].concat(v).join(", ")}`).join("; ");
  } catch {}
  if (m[1] === "401" || m[1] === "403") return `Recall refused the API key (${m[1]}). Check RECALL_API_KEY and RECALL_REGION in .env.`;
  return `Recall wouldn't send Cue (${m[1]}): ${detail}`;
}

async function send(meetingUrl) {
  if (["starting", "joining", "lobby", "in_call", "leaving"].includes(state.phase)) throw new Error("Cue is already on its way or in a call.");
  if (!/^https:\/\/\S+$/.test(meetingUrl)) throw new Error("That doesn't look like a meeting link. Paste the whole https://… address.");
  if (!process.env.RECALL_API_KEY) throw new Error("RECALL_API_KEY isn't set in .env.");
  Object.assign(state, { message: "getting the server and tunnel ready…", meetingUrl, botId: "", sentAt: 0, endedAt: 0, screen: null, phaseAt: {} });
  setPhase("starting");
  state.log = [];
  state.feed = [];
  lastHeard = null;
  (async () => {
    try {
      const url = await ensurePublic();
      state.message = "sending Cue to the meeting…";
      const bot = await createBot(meetingUrl, url).catch((err) => { throw new Error(plainRecallError(err)); });
      Object.assign(state, { botId: bot.id, sentAt: Date.now(), message: STATUS.joining_call });
      setPhase("joining");
      step(`Cue is on its way. It leaves by itself after ${MAX_MINUTES} minutes.`);
      maxTimer = setTimeout(() => leave(`${MAX_MINUTES} minutes are up`), MAX_MINUTES * 60_000);
      watch = new AbortController();
      const last = await watchBot(bot.id, (now) => {
        if (state.phase === "leaving" && PHASE[now.code] === "in_call") return;
        if (PHASE[now.code]) setPhase(PHASE[now.code]);
        state.message = (STATUS[now.code] || now.code) + (now.sub_code ? ` (${now.sub_code.replaceAll("_", " ")})` : "");
        step(state.message);
      }, { signal: watch.signal });
      clearTimeout(maxTimer);
      if (last?.code !== "fatal") setPhase("left");
      state.endedAt = Date.now();
    } catch (err) {
      clearTimeout(maxTimer);
      Object.assign(state, { message: err.message, endedAt: Date.now() });
      setPhase("error");
      step(err.message);
      if (state.botId) await leaveCall(state.botId).catch(() => {});
    }
  })();
}

async function leave(why = "taken out from the panel") {
  if (!state.botId || ["left", "error", "idle"].includes(state.phase)) return;
  clearTimeout(maxTimer);
  setPhase("leaving");
  state.message = "taking Cue out of the call…";
  step(`${why}: taking Cue out of the call…`);
  try {
    await leaveCall(state.botId);
  } catch (err) {
    // Already gone, most often. Anything else: the bot may still be billing.
    step(`Recall said: ${err.message}. If Cue is still in the call, remove it from Recall's dashboard.`);
  }
}

// ---------- the panel's own page and API ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const HOSTS = new Set([`127.0.0.1:${PANEL_PORT}`, `localhost:${PANEL_PORT}`]);

function reply(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-frame-options": "DENY" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 10_000) throw new Error("body too large");
  }
  return JSON.parse(raw || "{}");
}

const panel = http.createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host)) return reply(res, 403, "wrong host", "text/plain");
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      const since = Number(url.searchParams.get("since") || 0);
      return reply(res, 200, { ...state, now: Date.now(), problems: problems(), feed: state.feed.filter((f) => f.id > since) });
    }
    if (req.method === "POST") {
      if (req.headers["x-cue-panel"] !== "1") return reply(res, 403, { error: "missing x-cue-panel header" });
      if (url.pathname === "/api/send") {
        const body = await readJson(req);
        await send(String(body.meetingUrl || "").trim());
        return reply(res, 200, { ok: true });
      }
      if (url.pathname === "/api/leave") {
        await leave();
        return reply(res, 200, { ok: true });
      }
    }
    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.join(PANEL_DIR, rel);
      if (!file.startsWith(PANEL_DIR + path.sep)) return reply(res, 403, "forbidden", "text/plain");
      const data = await fs.readFile(file).catch(() => null);
      if (!data) return reply(res, 404, "not found", "text/plain");
      return reply(res, 200, data, TYPES[path.extname(file)] || "application/octet-stream");
    }
    reply(res, 405, { error: "method not allowed" });
  } catch (err) {
    reply(res, 400, { error: String(err.message || err) });
  }
});

tapUrl = await startTap();
panel.on("error", (err) => {
  console.error(`[panel] can't listen on 127.0.0.1:${PANEL_PORT} (${err.code}); set PANEL_PORT to another port`);
  process.exit(1);
});
panel.listen(PANEL_PORT, "127.0.0.1", () => console.log(`[panel] open http://127.0.0.1:${PANEL_PORT}  (Ctrl+C takes Cue out and stops)`));

let stopping = false;
process.on("SIGINT", async () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log("[panel] stopping…");
  await leave("the panel stopped");
  children.tunnel?.kill();
  children.server?.kill();
  process.exit(0);
});
