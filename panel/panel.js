// The panel page: polls scripts/panel.mjs once a second and renders what it says.
// Icons are Lucide's (ISC licence), inlined.
const $ = (id) => document.getElementById(id);
const ACTIVE = new Set(["starting", "joining", "lobby", "in_call", "leaving"]);

const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  live: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  slide: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  diagram: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  caption: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  play: '<path d="M6 3 20 12 6 21Z"/>',
  bell: '<path d="M10.3 21a2 2 0 0 0 3.4 0"/><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  quiet: '<path d="M5 12h14"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  door: '<path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01"/><path d="M13 4.56v16.16a.5.5 0 0 1-.63.48L5 19.13V5.56a2 2 0 0 1 1.47-1.93l4-1.08A2 2 0 0 1 13 4.56Z"/>',
};
const icon = (name, cls = "") => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", `icon ${cls}`);
  s.innerHTML = ICON[name];
  return s;
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const TOOL = {
  show_slide: ["slide", "Showed a slide"],
  show_diagram: ["diagram", "Drew a diagram"],
  show_research: ["search", "Opened research"],
  caption: ["caption", "Captioned"],
  ping: ["bell", "Pinged"],
  play_video: ["play", "Played a video"],
  stop_video: ["play", "Stopped the video"],
  set_audio: ["bell", "Changed its sound"],
  set_screen: ["slide", "Changed its screen"],
};
const STEPS = [["starting", "Starting up"], ["joining", "Joining"], ["lobby", "In the lobby"], ["in_call", "In the call"], ["left", "Left"]];
const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9", "#8b5cf6", "#f97316", "#14b8a6"];
// Speakers get colours in the order they first speak, so two people never share one.
const speakerColors = new Map();
const colorOf = (name) => {
  if (!speakerColors.has(name)) speakerColors.set(name, COLORS[speakerColors.size % COLORS.length]);
  return speakerColors.get(name);
};

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hms = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const money = (ms, rate) => `$${((ms / 3_600_000) * rate).toFixed(2)}`;

function describe(a) {
  const i = a.input || {};
  if (a.tool === "set_audio") return ["bell", i.muted ? "Muted itself" : "Unmuted itself", ""];
  if (a.tool === "set_screen") return ["slide", i.visible ? "Showed its screen" : "Hid its screen", ""];
  const [ic, verb] = TOOL[a.tool] || ["zap", a.tool.replaceAll("_", " ")];
  const what = i.text ? `“${i.text}”` : i.title || i.url || i.sound || "";
  return [ic, verb, what];
}

// ---------- the feed ----------

let since = 0;
let run = "";
let tail = null; // { kind, speaker, at, el } of the last line or action appended
let quiet = null; // { el, count }: one row, always last, counting quiet ticks since Cue last acted
let counts = { lines: 0, actions: 0 };

function resetFeed() {
  $("feed").replaceChildren();
  speakerColors.clear();
  tail = null;
  quiet = null;
  counts = { lines: 0, actions: 0 };
}

function append(f) {
  const list = $("feed");
  list.querySelector(".empty")?.remove();
  // Everything goes above the quiet row, which stays at the bottom.
  const add = (node) => (quiet ? list.insertBefore(node, quiet.el) : list.append(node));
  if (f.kind === "heard") {
    counts.lines++;
    // Consecutive lines from one speaker sit under one name, as in a chat.
    if (tail?.kind === "heard" && tail.speaker === f.speaker && f.at - tail.at < 120_000) {
      tail.el.querySelector(".lines").append(el("p", "", f.text));
      tail.at = f.at;
      return;
    }
    const li = el("li", "msg");
    const av = el("span", "avatar", f.speaker.trim().charAt(0).toUpperCase() || "?");
    av.style.background = colorOf(f.speaker);
    const head = el("div", "head");
    head.append(el("span", "name", f.speaker), el("span", "time", hm(f.at)));
    const lines = el("div", "lines");
    lines.append(el("p", "", f.text));
    li.append(av, head, lines);
    add(li);
    tail = { kind: "heard", speaker: f.speaker, at: f.at, el: li };
  } else if (f.kind === "quiet") {
    // Quiet ticks don't interrupt the conversation: one row at the bottom counts them.
    if (!quiet) {
      const li = el("li", "sys");
      li.append(icon("quiet"), el("span", "what"), el("time"));
      list.append(li);
      quiet = { el: li, count: 0 };
    }
    quiet.count++;
    quiet.el.querySelector(".what").textContent = quiet.count === 1 ? "Checked in and stayed quiet" : `Checked in ${quiet.count} times and stayed quiet`;
    quiet.el.querySelector("time").textContent = `last at ${hm(f.at)}`;
  } else if (f.kind === "failed") {
    const li = el("li", "fail");
    li.textContent = `Couldn't think: ${f.text}`;
    add(li);
    tail = { kind: "failed" };
  } else {
    counts.actions += f.actions.length;
    const li = el("li", "act");
    f.actions.forEach((a, n) => {
      const [ic, verb, what] = describe(a);
      const row = el("div", "row");
      row.append(icon(ic), el("b", "", verb));
      if (what) row.append(el("span", "what", what));
      if (n === 0) row.append(el("span", "meta", `${(f.ms / 1000).toFixed(1)} s · ${hm(f.at)}`));
      li.append(row);
    });
    add(li);
    tail = { kind: "did" };
    // The count restarts after each action, so the row reads "since Cue last did something".
    quiet?.el.remove();
    quiet = null;
  }
}

function renderFeed(st, items) {
  const list = $("feed");
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  for (const f of items) append(f);
  while (list.children.length > 400) list.firstElementChild.remove();
  if (stick) list.scrollTop = list.scrollHeight;

  if (!list.children.length || list.querySelector(".empty")) {
    const [ic, title, body, cls] = emptyFor(st);
    const box = el("li", `empty ${cls || ""}`);
    const big = el("span", "big");
    big.append(icon(ic, ic === "loader" ? "spin" : ""));
    box.append(big, el("strong", "", title), el("span", "", body));
    list.replaceChildren(box);
  }
  const parts = [`${counts.lines} ${counts.lines === 1 ? "line" : "lines"}`, `${counts.actions} ${counts.actions === 1 ? "action" : "actions"}`];
  $("feedCount").textContent = parts.join(" · ");
}

function emptyFor(st) {
  const wasIn = Boolean(st.phaseAt?.in_call);
  if (st.phase === "error") return ["alert", wasIn ? "Something went wrong" : "Cue couldn't get into the call", st.message, "bad"];
  if (st.publicUrl && !st.tapped) return ["alert", "No live feed", "Cue is using PUBLIC_URL, so its think calls skip the panel.", ""];
  return {
    starting: ["loader", "Getting ready", "Starting the server and opening a tunnel. This takes up to a minute."],
    joining: ["loader", "Joining the call", "Cue is dialling in."],
    lobby: ["door", "Admit Cue from the meeting", "It's waiting in the lobby. Someone in the call has to let it in.", "wait"],
    in_call: ["mic", "Listening", "What people say, and what Cue does about it, shows up here."],
    leaving: ["loader", "Leaving", "Waiting for Recall to confirm."],
    left: ["out", "Cue left the call", "Nothing was said while it was in."],
  }[st.phase] || ["mic", "Nothing yet", ""];
}

// ---------- the rail ----------

function renderTimeline(st) {
  const at = st.phaseAt || {};
  const when = (p) => at[p] || (p === "left" && at.leaving);
  const current = STEPS.map(([p]) => Boolean(when(p))).lastIndexOf(true);
  $("stepper").replaceChildren(...STEPS.map(([p, label], i) => {
    const li = el("li");
    let ic = "circle";
    if (i < current) { li.className = "done"; ic = "check"; }
    if (i === current) {
      li.className = "now";
      if (st.phase === "error") { li.className = "failed"; ic = "alert"; }
      else if (p === "lobby") { li.classList.add("wait"); ic = "clock"; }
      else if (p === "in_call") { li.classList.add("live"); ic = "live"; }
      else if (p === "left" && st.phase === "left") { li.className = "done"; ic = "check"; }
      else ic = "loader";
    }
    li.append(icon(ic, ic === "loader" ? "spin" : ""), el("span", "", st.phase === "leaving" && p === "left" ? "Leaving" : label));
    li.append(el("time", "", when(p) ? hm(when(p)) : i < current ? "skipped" : ""));
    return li;
  }));
}

function renderScreen(s) {
  const box = $("screen");
  box.replaceChildren();
  const idle = !s || !s.mode || s.mode === "idle";
  box.className = `screen${idle ? " idle" : ""}`;
  if (idle) box.append(el("span", "", "Listening quietly"));
  else {
    box.append(el("span", "mode", s.mode));
    if (s.title) box.append(el("span", "title", s.title));
    if (s.url) box.append(el("span", "url truncate", s.url));
    if (Array.isArray(s.bullets) && s.bullets.length) {
      const ul = el("ul");
      for (const b of s.bullets.slice(0, 4)) ul.append(el("li", "", String(b)));
      box.append(ul);
    }
  }
  const flags = [s?.screenHidden && "hidden from the call", s?.audioMuted && "muted"].filter(Boolean);
  if (flags.length) box.append(el("span", "flags", flags.join(" · ")));
}

// ---------- everything ----------

function render(st) {
  $("problems").replaceChildren(...st.problems.map((p) => {
    const d = el("div", `alert ${p.level}`);
    d.append(icon("alert"), el("span", "", p.text));
    return d;
  }));

  const active = ACTIVE.has(st.phase);
  const started = st.phase !== "idle";
  const wasIn = Boolean(st.phaseAt?.in_call);
  $("hero").hidden = active;
  $("hero").classList.toggle("compact", started);
  $("fine").textContent = `Recall bills about $${st.rate.toFixed(2)} an hour while Cue is in. It leaves by itself after ${st.maxMinutes} minutes, or once everyone else has gone.`;
  $("sendBtn").disabled = st.problems.some((p) => p.level === "error");
  $("live").hidden = !started;

  // The pill: where Cue is, and the clock and meter while it bills.
  const ms = st.sentAt ? (st.endedAt || st.now) - st.sentAt : 0;
  const pill = {
    starting: ["wait", "Starting…"], joining: ["wait", "Joining…"], lobby: ["wait", "In the lobby"],
    in_call: ["live", "In the call"], leaving: ["wait", "Leaving…"], left: ["", "Left"], error: ["bad", wasIn ? "Stopped" : "Couldn't join"],
  }[st.phase];
  $("pill").hidden = !pill;
  if (pill) {
    $("dot").className = `dot ${pill[0]}`;
    const t = $("pillText");
    t.replaceChildren(document.createTextNode(pill[1]));
    if (st.sentAt) t.append(el("span", "sep", " · "), el("span", "soft", clock(ms)), el("span", "sep", " · "), el("span", "soft", money(ms, st.rate)));
  }
  const leave = $("leaveBtn");
  leave.hidden = !active;
  leave.disabled = st.phase === "leaving";
  leave.replaceChildren(icon("out"), document.createTextNode(st.phase === "starting" ? "Cancel" : st.phase === "leaving" ? "Leaving…" : "Take Cue out"));

  $("meetingLabel").textContent = st.meetingUrl;
  $("meetingLabel").title = st.meetingUrl;
  renderTimeline(st);
  const note = $("phaseDetail");
  note.textContent = st.phase === "error" ? st.message : st.phase === "lobby" ? "Someone in the call has to admit Cue." : "";
  note.className = `note${st.phase === "error" ? " bad" : ""}`;
  note.hidden = !note.textContent;

  $("elapsed").textContent = clock(ms);
  $("cost").textContent = money(ms, st.rate);
  $("costLabel").textContent = active ? "Cost so far" : "Cost";
  $("leavesLabel").textContent = active ? "Leaves by itself in" : "Ended";
  $("leavesAt").textContent = active ? (st.sentAt ? clock(st.sentAt + st.maxMinutes * 60_000 - st.now) : `${st.maxMinutes}:00`) : st.endedAt ? hm(st.endedAt) : "—";

  $("screenCard").hidden = !wasIn;
  renderScreen(st.screen);
  $("steps").replaceChildren(...st.log.map((l) => { const li = el("li"); li.append(el("time", "", hms(l.at)), el("span", "", l.text)); return li; }));

  $("phaseText").textContent = "Transcript";
  document.title = pill && active ? `${pill[1]} · Cue` : "Cue";

  renderFeed(st, st.feed);
  $("feedEnd").hidden = active || !st.endedAt || !wasIn;
  $("feedEnd").textContent = `Cue left at ${hm(st.endedAt || st.now)}. Nothing more is recorded.`;
}

async function poll() {
  try {
    let st = await (await fetch(`/api/state?since=${since}`)).json();
    if (run && st.run !== run) {
      // The panel process restarted: its feed ids start again, so take the whole feed.
      since = 0;
      resetFeed();
      st = await (await fetch("/api/state?since=0")).json();
    }
    run = st.run;
    if (st.feed.length) since = st.feed.at(-1).id;
    render(st);
  } catch {
    $("problems").replaceChildren(Object.assign(el("div", "alert error"), { textContent: "The panel isn't answering. Is `npm run panel` still running?" }));
  }
  setTimeout(poll, 1000);
}

const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-cue-panel": "1" }, body: JSON.stringify(body || {}) })
    .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || r.statusText); return d; }));

$("sendForm").onsubmit = async (e) => {
  e.preventDefault();
  $("sendBtn").disabled = true;
  try {
    await post("/api/send", { meetingUrl: $("meetingUrl").value });
    since = 0;
    resetFeed();
  } catch (err) {
    alert(err.message);
  } finally {
    $("sendBtn").disabled = false;
  }
};
$("leaveBtn").onclick = () => post("/api/leave").catch((err) => alert(err.message));

// A link copied with stray spaces or the "Join with Google Meet" text around it.
$("meetingUrl").addEventListener("paste", (e) => {
  const m = (e.clipboardData.getData("text") || "").match(/https:\/\/\S+/);
  if (m) { e.preventDefault(); $("meetingUrl").value = m[0]; }
});

poll();

// ---------- model and thinking ----------
// Writes .cue-settings.json through the panel's local API; agent.js picks it up on the next look.
const LABELS = { "claude-haiku-5-5": "Haiku 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };
async function setupBrain() {
  let st;
  try { st = await (await fetch("/api/settings")).json(); } catch { return; }
  const fill = (sel, items, value, label = (x) => x) => {
    sel.replaceChildren(...items.map((v) => Object.assign(document.createElement("option"), { value: v, textContent: label(v), selected: v === value })));
  };
  fill($("modelSel"), st.models, st.model, (m) => LABELS[m] || m);
  fill($("effortSel"), st.efforts, st.effort);
  $("brain").hidden = false;
  const save = async () => {
    $("brainNote").textContent = "…";
    try {
      await post("/api/settings", { model: $("modelSel").value, effort: $("effortSel").value });
      $("brainNote").textContent = "saved";
    } catch (e) {
      $("brainNote").textContent = e.message;
    }
    setTimeout(() => { $("brainNote").textContent = ""; }, 2500);
  };
  $("modelSel").onchange = save;
  $("effortSel").onchange = save;
}
setupBrain();
