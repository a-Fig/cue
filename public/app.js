// The page that runs inside the Recall bot (or your browser with ?test=1).
// Listens to the transcript, asks /api/think what to do, renders the result.

const params = new URLSearchParams(location.search);
const TOKEN = params.get("token") || "";
const TEST = params.has("test");
const NAME = params.get("name") || "Quiet Intern";

const TICK_MS = 4000;        // how often we consider thinking
const QUIET_GAP_MS = 2500;   // wait for a pause in speech before thinking...
const MAX_WAIT_MS = 15000;   // ...but never longer than this while people talk
const CONTEXT_MS = 4 * 60 * 1000; // send the last ~4 minutes of transcript
const CAPTION_MS = 12000;

const $ = (id) => document.getElementById(id);
const state = {
  transcript: [],       // {speaker, text, t}
  lastLineAt: 0,
  lastThinkAt: 0,
  pendingSince: 0,      // first unprocessed line time, 0 when caught up
  addressed: false,     // someone said "intern"
  busy: false,
  screen: { mode: "idle" },
  muted: params.has("muted"), // start muted with ?muted
  hidden: false,
  recentActions: [],
};

$("botName").textContent = NAME;

// ---------- stage scaling (keeps 1280x720 layout in any window) ----------
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720);
  document.documentElement.style.setProperty("--scale", String(s));
}
addEventListener("resize", fit);
fit();

// ---------- status ----------
function setStatus(text, mode = "ok") {
  $("statusText").textContent = text;
  $("dot").className = "dot" + (mode === "busy" ? " busy" : mode === "off" ? " off" : "");
}

function log(...args) {
  console.log("[intern]", ...args);
  if (TEST) {
    const el = $("testLog");
    el.textContent = `${args.join(" ")}\n${el.textContent}`.slice(0, 4000);
  }
}

// ---------- transcript in ----------
function addLine(speaker, text) {
  text = (text || "").trim();
  if (!text) return;
  const t = Date.now();
  state.transcript.push({ speaker: speaker || "Someone", text, t });
  state.transcript = state.transcript.filter((l) => t - l.t < CONTEXT_MS);
  state.lastLineAt = t;
  if (!state.pendingSince) state.pendingSince = t;
  if (/\bintern\b/i.test(text)) state.addressed = true;
  $("ticker").textContent = `${speaker}: ${text}`;
  localCommand(text);
}

// Control phrases run instantly in the page, without waiting for Claude,
// so "intern, mute" always works. Claude still sees the line and the new state.
const COMMANDS = [
  [/\bunmute\b/, () => setAudio(false)],
  [/\b(mute|be quiet|shush|no (more )?(sounds?|noise))\b/, () => setAudio(true)],
  [/\bstop (the |that )?(video|clip)\b|\bstop playing\b/, () => stopVideo(true)],
  [/\b(hide|close|stop sharing|turn off) (your |the )?screen\b|\bget off (the )?screen\b/, () => setScreen(false)],
  [/\b(show|share|bring back|turn on) (your |the )?screen\b/, () => setScreen(true)],
];
function localCommand(text) {
  const m = text.toLowerCase().match(/\bintern\b[\s,.!:-]*(.*)/);
  if (!m) return;
  const rest = m[1];
  // Run every command in the line, so "unmute and show your screen" does both.
  const hits = COMMANDS.filter(([re]) => re.test(rest));
  hits.forEach(([, run]) => run());
  if (hits.length) log("local command:", rest);
}

// Recall's in-bot websocket. Message shape follows Recall's real-time
// transcription "data" object; parse defensively in case it's wrapped.
function connectRecall() {
  const ws = new WebSocket("wss://meeting-data.bot.recall.ai/api/v1/transcript");
  ws.onopen = () => { setStatus("listening"); log("transcript socket open"); };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const d = msg?.data?.data || msg?.data || msg?.transcript || msg;
    const words = d?.words || d?.transcript?.words;
    if (!Array.isArray(words)) return;
    const speaker = d?.participant?.name || d?.speaker || "Someone";
    addLine(speaker, words.map((w) => w.text).join(" "));
  };
  ws.onclose = () => {
    setStatus("reconnecting", "off");
    setTimeout(connectRecall, 3000);
  };
}

// ---------- deciding when to think ----------
async function maybeThink(force = false) {
  if (state.busy) return;
  const now = Date.now();
  const hasNew = state.pendingSince > 0;
  const paused = now - state.lastLineAt > QUIET_GAP_MS;
  const waitedLong = hasNew && now - state.pendingSince > MAX_WAIT_MS;
  if (!force && !(hasNew && (paused || waitedLong || state.addressed))) return;

  state.busy = true;
  state.pendingSince = 0;
  state.addressed = false;
  state.lastThinkAt = now;
  setStatus("thinking…", "busy");
  try {
    const r = await fetch(`/api/think?token=${encodeURIComponent(TOKEN)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: state.transcript.map(({ speaker, text }) => ({ speaker, text })),
        screen: { ...state.screen, audioMuted: state.muted, screenHidden: state.hidden },
        recentActions: state.recentActions,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    log("actions:", data.actions.map((a) => a.tool).join(", ") || "quiet");
    for (const a of data.actions) await apply(a);
  } catch (err) {
    log("think failed:", err.message);
  } finally {
    state.busy = false;
    setStatus("listening");
  }
}
setInterval(maybeThink, TICK_MS);

// ---------- actions out ----------
function remember(text) {
  state.recentActions.push(text);
  state.recentActions = state.recentActions.slice(-6);
}

function showView(name) {
  if (name !== "video") stopVideo();
  for (const el of document.querySelectorAll(".view")) {
    el.classList.toggle("active", el.id === `view-${name}`);
  }
}

async function apply({ tool, input }) {
  switch (tool) {
    case "show_slide": return showSlide(input);
    case "show_diagram": return showDiagram(input);
    case "show_research": return showResearch(input);
    case "caption": return showCaption(input.text);
    case "ping": return ping(input.sound);
    case "play_video": return playVideo(input);
    case "stop_video": return stopVideo(true);
    case "set_audio": return setAudio(input.muted);
    case "set_screen": return setScreen(input.visible);
  }
}

// ---------- video ----------
// YouTube plays in an embed; anything else is treated as a direct video file.
function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]+)/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}

let ytFrame = null;
function ytCommand(func) {
  ytFrame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
}

function playVideo({ url, title, start_seconds = 0 }) {
  stopVideo();
  const box = $("videoBox");
  const id = youtubeId(url);
  const start = Math.max(0, Math.floor(start_seconds || 0));
  if (id) {
    const src = new URL(`https://www.youtube.com/embed/${encodeURIComponent(id)}`);
    src.search = new URLSearchParams({
      autoplay: "1", start: String(start), enablejsapi: "1", rel: "0", playsinline: "1", controls: "0", iv_load_policy: "3",
      mute: state.muted ? "1" : "0", origin: location.origin,
    });
    ytFrame = Object.assign(document.createElement("iframe"), {
      src: src.toString(), allow: "autoplay; encrypted-media", title,
    });
    box.replaceChildren(ytFrame);
  } else {
    const v = Object.assign(document.createElement("video"), {
      src: url, autoplay: true, controls: false, muted: state.muted, playsInline: true,
    });
    v.addEventListener("loadedmetadata", () => { if (start) v.currentTime = start; }, { once: true });
    v.addEventListener("error", () => log("video failed to load:", url));
    v.play().catch((e) => log("video play blocked:", e.message));
    box.replaceChildren(v);
  }
  $("videoTitle").textContent = title;
  // Switch view without stopping the video we just started.
  for (const el of document.querySelectorAll(".view")) el.classList.toggle("active", el.id === "view-video");
  state.screen = { mode: "video", title, url };
  remember(`video: ${title}`);
}

function stopVideo(explicit = false) {
  const box = $("videoBox");
  if (!box.firstChild) return;
  box.querySelector("video")?.pause();
  box.replaceChildren(); // removing the iframe stops YouTube too
  ytFrame = null;
  if (explicit) {
    showView("idle");
    state.screen = { mode: "idle" };
    remember("stopped video");
  }
}

// ---------- mute and screen ----------
function setAudio(muted) {
  state.muted = Boolean(muted);
  $("mutedBadge").hidden = !state.muted;
  const v = $("videoBox").querySelector("video");
  if (v) v.muted = state.muted;
  ytCommand(state.muted ? "mute" : "unMute");
  if (audio) state.muted ? audio.suspend() : audio.resume();
  remember(state.muted ? "muted" : "unmuted");
}

function setScreen(visible) {
  state.hidden = !visible;
  $("cover").hidden = visible;
  remember(visible ? "screen shown" : "screen hidden");
}

function showSlide({ title, bullets }) {
  $("slideTitle").textContent = title;
  const ul = $("slideBullets");
  ul.replaceChildren(...bullets.slice(0, 6).map((b, i) => {
    const li = document.createElement("li");
    li.textContent = b;
    li.style.animationDelay = `${i * 90}ms`;
    return li;
  }));
  showView("slide");
  state.screen = { mode: "slide", title, bullets };
  remember(`slide: ${title}`);
}

let mermaidLib;
async function showDiagram({ title, mermaid }) {
  try {
    mermaidLib ||= (await import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")).default;
    mermaidLib.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    const { svg } = await mermaidLib.render(`m${Date.now()}`, mermaid);
    $("diagramBox").innerHTML = svg;
    $("diagramTitle").textContent = title;
    showView("diagram");
    state.screen = { mode: "diagram", title, mermaid };
    remember(`diagram: ${title}`);
  } catch (err) {
    log("mermaid failed:", err.message);
  }
}

// --- research: open the page, highlight the quotes, walk through them ---
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").toLowerCase();
const squash = (s) => s.replace(/\s+/g, " ").trim();

function markParagraph(text, quotes) {
  // Find each quote (or its first 60 chars) in this paragraph. Replacements in
  // norm() are 1:1, so indexes in the normalized text match the original.
  const hay = norm(text);
  const ranges = [];
  quotes.forEach((q, qi) => {
    const needle = norm(squash(q));
    let i = hay.indexOf(needle);
    let len = needle.length;
    if (i < 0 && needle.length > 60) {
      i = hay.indexOf(needle.slice(0, 60));
      len = Math.min(needle.length, text.length - i);
    }
    if (i >= 0) ranges.push({ start: i, end: i + len, qi });
  });
  if (!ranges.length) return null;
  ranges.sort((a, b) => a.start - b.start);
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue;
    frag.append(text.slice(pos, r.start));
    const m = document.createElement("mark");
    m.dataset.q = String(r.qi);
    m.textContent = text.slice(r.start, r.end);
    frag.append(m);
    pos = r.end;
  }
  frag.append(text.slice(pos));
  return frag;
}

let walkTimer;
async function showResearch({ url, title, summary, highlights }) {
  clearInterval(walkTimer);
  $("researchUrl").textContent = url;
  $("researchTitle").textContent = title;
  $("researchSummary").textContent = summary;
  $("researchSource").textContent = url;
  $("researchHighlights").replaceChildren(...highlights.map((h) => {
    const li = document.createElement("li");
    li.textContent = `“${h}”`;
    return li;
  }));
  const pageEl = $("researchPage");
  pageEl.replaceChildren(Object.assign(document.createElement("p"), { className: "fallback", textContent: "Opening page…" }));
  showView("research");
  state.screen = { mode: "research", title, url };
  remember(`research: ${title}`);

  try {
    const r = await fetch(`/api/page?token=${encodeURIComponent(TOKEN)}&url=${encodeURIComponent(url)}`);
    const page = await r.json();
    if (!r.ok) throw new Error(page.error || r.status);
    const h1 = document.createElement("h1");
    h1.textContent = page.title;
    const nodes = [h1];
    for (const para of page.paragraphs) {
      const p = document.createElement("p");
      const marked = markParagraph(para, highlights);
      marked ? p.append(marked) : (p.textContent = para);
      nodes.push(p);
    }
    pageEl.replaceChildren(...nodes);
  } catch (err) {
    log("page fetch failed:", err.message);
    pageEl.replaceChildren(Object.assign(document.createElement("p"), {
      className: "fallback",
      textContent: "This site wouldn't open here, so the quotes are on the right.",
    }));
    return;
  }

  // Scroll to each highlight in turn so the "intern" walks through what it found.
  const marks = [...pageEl.querySelectorAll("mark")];
  if (!marks.length) return;
  const items = [...$("researchHighlights").children];
  let k = 0;
  const focus = () => {
    const m = marks[k % marks.length];
    marks.forEach((x) => x.classList.remove("focus"));
    items.forEach((x) => x.classList.remove("focus"));
    pageEl.scrollTo({ top: Math.max(0, m.offsetTop - pageEl.clientHeight / 3), behavior: "smooth" });
    m.classList.add("focus");
    items[Number(m.dataset.q)]?.classList.add("focus");
    k++;
  };
  focus();
  if (marks.length > 1) walkTimer = setInterval(focus, 6000);
}

let captionTimer;
function showCaption(text) {
  const el = $("caption");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => el.classList.remove("show"), CAPTION_MS);
  remember(`caption: ${text}`);
}

// --- pings: synthesized, so there are no audio files to host ---
let audio;
function ping(kind = "soft") {
  if (state.muted) return log("ping skipped (muted)");
  audio ||= new AudioContext();
  audio.resume();
  const notes = { soft: [880], chime: [660, 990], alert: [1046, 1046, 1046] }[kind] || [880];
  notes.forEach((freq, i) => {
    const t = audio.currentTime + i * 0.18;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
  remember(`ping: ${kind}`);
}

// ---------- test mode ----------
const DEMO = [
  ["Sam", "Okay so for the launch we need to sort out pricing, the landing page, and who handles support."],
  ["Alex", "Right. And Priya said she can own support if we get her a help desk tool by Friday."],
  ["Sam", "The signup flow is: they land on the page, enter email, get a magic link, then onboarding, then the dashboard."],
  ["Alex", "Intern, can you look up how big the global video conferencing market is?"],
];

function setupTest() {
  $("testpanel").hidden = false;
  setStatus("test mode");
  const send = () => {
    addLine($("testSpeaker").value, $("testText").value);
    $("testText").value = "";
  };
  $("testpanel").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("testText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("thinkNow").onclick = () => maybeThink(true);
  $("demoScript").onclick = async () => {
    for (const [who, line] of DEMO) {
      addLine(who, line);
      await new Promise((r) => setTimeout(r, 1500));
      await maybeThink(true);
    }
  };
  // Unlock audio on first interaction (browsers block it until then).
  addEventListener("pointerdown", () => { audio ||= new AudioContext(); audio.resume(); }, { once: true });
}

$("mutedBadge").hidden = !state.muted;
TEST ? setupTest() : connectRecall();
