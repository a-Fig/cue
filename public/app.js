// The page that runs inside the Recall bot (or your browser with ?test=1).
// Listens to the transcript, asks /api/think what to do, renders the result.
import { addNotes, currentNotes } from "./views/notes.js";
import { showComparison } from "./views/compare.js";
import { showSlide } from "./views/slide.js";
import { showDiagram } from "./views/diagram.js";
import { showVisual } from "./views/visual.js";
import { showImage } from "./views/image.js";

import { allFiller } from "./filler.js";

const params = new URLSearchParams(location.search);
const TOKEN = params.get("token") || "";
const TEST = params.has("test");
const NAME = params.get("name") || "Cue";

// How soon Cue looks at what was said (#26). With the Jev gate (#53) a look that ends "quiet"
// costs ~$0.00002 and well under a second, so the page can look often: every 0.5 s, after a
// 0.8 s pause, and at least every 6 s while people keep talking. These were 4 s, 2.5 s and 15 s,
// when every look was a full Claude call; then a request waited up to 6.5 s before Cue even
// started on it. A wake word ("Cue, …") doesn't wait at all (#28).
const TICK_MS = 500;         // how often we consider thinking
const QUIET_GAP_MS = 800;    // wait for a pause in speech before thinking...
const MAX_WAIT_MS = 6000;    // ...but never longer than this while people talk
const CONTEXT_MS = 4 * 60 * 1000; // send the last ~4 minutes of transcript
const CAPTION_MS = 7000;

const $ = (id) => document.getElementById(id);
const state = {
  transcript: [],       // {speaker, text, t}
  lastLineAt: 0,
  lastThinkAt: 0,
  pendingSince: 0,      // first unprocessed line time, 0 when caught up
  addressed: false,     // someone said "Cue, …" (see WAKE)
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
// The pill reads "cue · <word>": what Cue is doing (thinking, reconnecting) or else what it is
// showing. It is ink over dark views and paper over sheets (#stage[data-tone]).
const LABELS = { idle: "listening", research: "found it", compare: "comparison", visual: "drawing" };
const viewLabel = () => (TEST && state.screen.mode === "idle" ? "test mode" : LABELS[state.screen.mode] || state.screen.mode);
function setStatus(text, mode = "ok") {
  const el = $("statusText");
  if (el.textContent !== text) {
    el.textContent = text;
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; // replay the fade-in
  }
  $("dot").className = "dot" + (mode === "off" ? " off" : "");
}
function setTone(name) {
  const view = document.getElementById(`view-${name}`);
  $("stage").dataset.tone = view?.classList.contains("sheet") ? "light" : "dark";
}

// Asked: someone said "cue, …". Over the idle screen the orb's ring turns and the request shows
// under it, "cue," in lime, until the answer lands.
function showAsked(text) {
  const m = WAKE.exec(text || "");
  const rest = m ? text.slice(m.index + m[0].length) : text;
  $("requestText").replaceChildren(Object.assign(document.createElement("b"), { textContent: "cue, " }), rest || "");
  $("stage").classList.add("asking");
}
const hideAsked = () => $("stage").classList.remove("asking");

function log(...args) {
  console.log("[cue]", ...args);
  if (TEST) {
    const el = $("testLog");
    el.textContent = `${args.join(" ")}\n${el.textContent}`.slice(0, 4000);
  }
}

// ---------- transcript in ----------
// How people address it: "Cue …", which speech-to-text may write "Q" or "queue", at the start of a
// line or sentence, after a comma, or after a filler like "so", "hey" or "okay". Recall's transcript
// can drop punctuation: the first real call wrote "so q find me the population of japan" (#31).
// Not a wake: "Q3", "the queue is long" (not at a start), "Queue is backed up", "Q and A",
// "Q's revenue". A false wake costs one think call, cheaper than a missed request. The old
// "intern, …" works anywhere.
const WAKE = /(?:(?:^|[.!?,;]\s*|\b(?:so|and|hey|ok|okay|um|uh|yo|alright)[\s,]+)(?:cue|queue(?!\s+(?:is|was|are)\b)|q)\b(?!['’]s|\s+(?:and|&|a)\b)|\bintern\b)[\s,.!:-]*/i;
function addLine(speaker, text) {
  text = (text || "").trim();
  if (!text) return;
  const t = Date.now();
  state.transcript.push({ speaker: speaker || "Someone", text, t });
  state.transcript = state.transcript.filter((l) => t - l.t < CONTEXT_MS);
  state.lastLineAt = t;
  if (!state.pendingSince) state.pendingSince = t;
  $("ticker").textContent = `${speaker}: ${text}`;
  localCommand(text);
  // Someone spoke to Cue: think now rather than on the next tick, which could be up to
  // TICK_MS away (#26). If a call is already running, its finally picks this up.
  if (WAKE.test(text)) {
    state.addressed = true;
    maybeThink();
  }
}

// Control phrases run instantly in the page, without waiting for Claude,
// so "Cue, mute" always works. Claude still sees the line and the new state.
const COMMANDS = [
  [/\bunmute\b/, () => setAudio(false)],
  [/\b(mute|be quiet|shush|no (more )?(sounds?|noise))\b/, () => setAudio(true)],
  [/\bstop (the |that )?(video|clip)\b|\bstop playing\b/, () => stopVideo(true)],
  [/\b(hide|close|stop sharing|turn off) (your |the )?screen\b|\bget off (the )?screen\b/, () => setScreen(false)],
  [/\b(show|share|bring back|turn on) (your |the )?screen\b/, () => setScreen(true)],
];
function localCommand(text) {
  const m = WAKE.exec(text);
  if (!m) return;
  const rest = text.slice(m.index + m[0].length).toLowerCase();
  // Run every command in the line, so "unmute and show your screen" does both.
  const hits = COMMANDS.filter(([re]) => re.test(rest));
  hits.forEach(([, run]) => run());
  if (hits.length) log("local command:", rest);
}

// Recall's in-bot websocket. Message shape follows Recall's real-time
// transcription "data" object; parse defensively in case it's wrapped.
function connectRecall() {
  const ws = new WebSocket("wss://meeting-data.bot.recall.ai/api/v1/transcript");
  ws.onopen = () => { setStatus(viewLabel()); log("transcript socket open"); };
  let rawLogged = 0;
  ws.onmessage = (ev) => {
    // The message shape is unverified (#4): log the first few raw, for Bot Explorer's console.
    if (rawLogged < 10) { rawLogged++; console.log("[cue] raw transcript message", ev.data); }
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
  // Only filler since the last look ("yeah", "got it"): a call could only
  // answer quiet, so skip it (#11; public/filler.js says what counts).
  if (!force && !state.addressed && allFiller(state.transcript.filter((l) => l.t > state.lastThinkAt))) {
    state.pendingSince = 0;
    state.lastThinkAt = now;
    return;
  }

  state.busy = true;
  state.pendingSince = 0;
  const addressed = force || state.addressed; // skips the Jev reflex on the server (#50)
  state.addressed = false;
  state.lastThinkAt = now;
  // A look the Jev gate answers "quiet" is back in well under a second, so "thinking" shows only
  // when Cue was asked, or when a look runs long enough to mean it is making something.
  const asked = addressed && !force ? [...state.transcript].reverse().find((l) => WAKE.test(l.text)) : null;
  if (addressed) setStatus("thinking");
  if (asked && state.screen.mode === "idle") showAsked(asked.text);
  const slow = setTimeout(() => setStatus("thinking"), 1200);
  try {
    const r = await fetch(`/api/think?token=${encodeURIComponent(TOKEN)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: state.transcript.map(({ speaker, text }) => ({ speaker, text })),
        screen: { ...state.screen, audioMuted: state.muted, screenHidden: state.hidden, notes: currentNotes() },
        recentActions: state.recentActions,
        addressed,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    log("actions:", data.actions.map((a) => a.tool).join(", ") || "quiet");
    for (const a of data.actions) await apply(a);
  } catch (err) {
    log("think failed:", err.message);
  } finally {
    clearTimeout(slow);
    hideAsked();
    state.busy = false;
    setStatus(viewLabel());
    if (state.addressed) maybeThink(); // spoken to while busy: answer now, not a tick later
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
  if (name !== "idle") hideAsked();
  setTone(name);
  setStatus(state.busy ? "thinking" : LABELS[name] || name);
}

const viewApi = {
  token: TOKEN,
  show: showView, remember, mode: () => state.screen.mode, screen: (s) => { state.screen = s; if (!state.busy) setStatus(viewLabel()); },
  heard: (re) => state.transcript.slice(-3).some((l) => re.test(l.text)), // in the last few lines
};

async function apply({ tool, input }) {
  switch (tool) {
    case "show_research": return showResearch(input);
    case "caption": return showCaption(input.text);
    case "ping": return ping(input.sound);
    case "play_video": return playVideo(input);
    case "stop_video": return stopVideo(true);
    case "set_audio": return setAudio(input.muted);
    case "set_screen": return setScreen(input.visible);
    // Views in public/views/ (#18) get only what they need from here.
    case "add_notes": return addNotes(input, viewApi);
    case "show_comparison": return showComparison(input, viewApi);
    case "show_slide": return showSlide(input, viewApi);
    case "show_diagram": return showDiagram(input, viewApi);
    case "show_visual": return showVisual(input, viewApi);
    case "show_image": return showImage(input, viewApi);
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
      disablekb: "1", fs: "0", cc_load_policy: "0", mute: state.muted ? "1" : "0", origin: location.origin,
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
    // timeupdate fires about 4 times a second; repaint the clock only when its text changes.
    v.addEventListener("timeupdate", () => {
      if (!v.duration) return;
      const text = `${clock(v.currentTime)} / ${clock(v.duration)}`;
      if ($("videoTime").textContent === text) return;
      $("videoTime").hidden = false;
      $("videoTime").textContent = text;
    });
    v.play().catch((e) => log("video play blocked:", e.message));
    box.replaceChildren(v);
  }
  $("videoTitle").textContent = title;
  // The bot's browser has little CPU to spare (#24): .playing stops every other animation on
  // the stage and takes the hidden views out of rendering while the video plays (style.css).
  $("stage").classList.add("playing");
  // Switch view without stopping the video we just started.
  for (const el of document.querySelectorAll(".view")) el.classList.toggle("active", el.id === "view-video");
  hideAsked();
  setTone("video");
  state.screen = { mode: "video", title, url };
  if (!state.busy) setStatus(viewLabel());
  remember(`video: ${title}`);
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function stopVideo(explicit = false) {
  const box = $("videoBox");
  $("videoTime").hidden = true;
  if (!box.firstChild) return;
  box.querySelector("video")?.pause();
  box.replaceChildren(); // removing the iframe stops YouTube too
  ytFrame = null;
  $("stage").classList.remove("playing");
  if (explicit) {
    state.screen = { mode: "idle" };
    showView("idle");
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

// --- research: the answer first, then one excerpt from the page as evidence ---
// The model's title is usually "<what>: <answer>" ("Germany population: ~83.5 million"), so the
// part after the colon becomes the big headline and the part before it the kicker.
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").toLowerCase();
const squash = (s) => s.replace(/\s+/g, " ").trim();
const EXCERPT_CHARS = 170; // context kept on each side of the quote

function splitTitle(title) {
  const i = title.indexOf(":");
  if (i > 0 && i < title.length - 1) return { kicker: title.slice(0, i).trim(), headline: title.slice(i + 1).trim() };
  return { kicker: "", headline: title.trim() };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// A quote counts only where all of it appears on the page, after whitespace and quote-mark
// normalisation (norm() replaces 1:1, so its indexes match the squashed text). Quotes the page
// doesn't contain are dropped, never shown as if sourced (#14).
function findQuotes(paragraphs, quotes) {
  const found = [];
  for (const q of quotes) {
    const needle = norm(squash(q));
    if (needle.length < 12) continue;
    for (const raw of paragraphs) {
      const text = squash(raw);
      const i = norm(text).indexOf(needle);
      if (i >= 0) { found.push({ text, start: i, end: i + needle.length }); break; }
    }
  }
  return found;
}

// The paragraph around one quote, cut at word boundaries, with the quote marked.
function excerptNode({ text, start, end }) {
  let from = Math.max(0, start - EXCERPT_CHARS);
  let to = Math.min(text.length, end + EXCERPT_CHARS);
  if (from > 0) { const sp = text.indexOf(" ", from); if (sp >= 0 && sp < start) from = sp + 1; }
  if (to < text.length) { const sp = text.lastIndexOf(" ", to); if (sp > end) to = sp; }
  const frag = document.createDocumentFragment();
  frag.append((from > 0 ? "…" : "") + text.slice(from, start));
  frag.append(Object.assign(document.createElement("mark"), { textContent: text.slice(start, end) }));
  frag.append(text.slice(end, to) + (to < text.length ? "…" : ""));
  return frag;
}

let walkTimer;
let researchGen = 0; // a newer showResearch wins over an older one still fetching its page
async function showResearch({ url, title, summary, highlights = [] }) {
  clearInterval(walkTimer);
  const gen = ++researchGen;
  const { kicker, headline } = splitTitle(title);
  const host = hostOf(url);
  const view = $("view-research");
  $("researchKicker").textContent = kicker;
  $("researchKicker").hidden = !kicker;
  $("researchHeadline").textContent = headline;
  $("researchHeadline").classList.toggle("long", headline.length > 22);
  $("researchSummary").textContent = summary;
  $("researchSource").textContent = host;
  const icon = $("researchIcon");
  icon.hidden = false;
  icon.onerror = () => { icon.hidden = true; };
  icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

  const excerpt = $("researchExcerpt");
  view.classList.remove("no-excerpt");
  excerpt.classList.add("loading");
  $("researchPageTitle").textContent = host;
  $("researchQuote").textContent = `Reading ${host}…`;
  $("researchDots").replaceChildren();
  showView("research");
  state.screen = { mode: "research", title, url };
  remember(`research: ${title}`);

  let found = [];
  let pageTitle = host;
  try {
    const r = await fetch(`/api/page?token=${encodeURIComponent(TOKEN)}&url=${encodeURIComponent(url)}`);
    const page = await r.json();
    if (!r.ok) throw new Error(page.error || r.status);
    pageTitle = page.title || host;
    found = findQuotes(page.paragraphs, highlights);
  } catch (err) {
    log("page fetch failed:", err.message);
  }
  if (gen !== researchGen || state.screen.mode !== "research") return; // the screen moved on meanwhile
  log(`quotes found on the page: ${found.length} of ${highlights.length}`);
  excerpt.classList.remove("loading");
  if (!found.length) return view.classList.add("no-excerpt");

  $("researchPageTitle").textContent = pageTitle;
  const dots = found.map(() => document.createElement("i"));
  $("researchDots").replaceChildren(...(found.length > 1 ? dots : []));
  let k = 0;
  const show = () => {
    $("researchQuote").replaceChildren(excerptNode(found[k % found.length]));
    dots.forEach((d, i) => d.classList.toggle("on", i === k % found.length));
    k++;
  };
  show();
  if (found.length > 1) walkTimer = setInterval(show, 7000);
}

let captionTimer;
// Cue is shy (Tyler, 2026-11-13): one short sentence, sometimes two. Anything longer is cut
// to its first two sentences, and a second sentence may wrap to a second line.
function showCaption(text) {
  const el = $("caption");
  const sentences = String(text || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
  $("captionText").textContent = sentences.join(" ");
  el.classList.toggle("two", sentences.length > 1);
  el.classList.add("show");
  hideAsked();
  $("stage").classList.add("captioning");
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => {
    el.classList.remove("show");
    $("stage").classList.remove("captioning");
  }, CAPTION_MS);
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
  ["Alex", "Cue, can you look up how big the global video conferencing market is?"],
];

function setupTest() {
  $("testpanel").hidden = false;
  setStatus(viewLabel());
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
setTone("idle");
TEST ? setupTest() : connectRecall();
