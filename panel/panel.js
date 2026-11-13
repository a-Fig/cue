// The panel page: polls scripts/panel.mjs once a second and renders what it says.
const $ = (id) => document.getElementById(id);
const ACTIVE = new Set(["starting", "joining", "lobby", "in_call", "leaving"]);

// The phase in plain words: a headline and what to do about it.
const PHASE = {
  starting: ["Getting ready…", "Starting the server and opening a tunnel. This takes up to a minute."],
  joining: ["Joining the call…", "Cue is dialing in."],
  lobby: ["Admit Cue from the meeting", "Cue is waiting in the lobby. Someone in the call has to let it in."],
  in_call: ["Cue is in the call", "It's listening, and shows things on its screen share when they help."],
  leaving: ["Taking Cue out…", "Waiting for Recall to confirm it has left."],
  left: ["Cue left the call", "It has stopped billing."],
  error: ["Something went wrong", ""],
};

const TOOL = {
  show_slide: "showed a slide",
  show_diagram: "drew a diagram",
  show_research: "opened research",
  caption: "said",
  ping: "pinged",
  play_video: "played a video",
  stop_video: "stopped the video",
  set_audio: "changed its sound",
  set_screen: "changed its screen",
};

let since = 0;

const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-cue-panel": "1" }, body: JSON.stringify(body || {}) })
    .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || r.statusText); return d; }));

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function describe(a) {
  const i = a.input || {};
  if (a.tool === "set_audio") return i.muted ? "muted itself" : "unmuted itself";
  if (a.tool === "set_screen") return i.visible ? "showed its screen" : "hid its screen";
  const what = i.text || i.title || i.url || i.sound || "";
  return [TOOL[a.tool] || a.tool.replaceAll("_", " "), what && (a.tool === "caption" ? `“${what}”` : what)].filter(Boolean).join(": ");
}

const STEPS = [["starting", "Starting"], ["joining", "Joining"], ["lobby", "Lobby"], ["in_call", "In call"], ["left", "Left"]];
const shortTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const empty = (text) => el("li", "empty", text);

function renderFeed(items) {
  const list = $("feed");
  if (!items.length) return;
  list.querySelector(".empty")?.remove();
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  for (const f of items) {
    const li = el("li", f.kind);
    const body = el("div");
    if (f.kind === "heard") {
      body.append(el("span", "who", f.speaker), document.createTextNode(f.text));
    } else if (f.kind === "quiet") {
      body.textContent = "stayed quiet";
      body.append(el("span", "ms", `${(f.ms / 1000).toFixed(1)} s`));
    } else if (f.kind === "failed") {
      body.textContent = `couldn't think: ${f.text}`;
    } else {
      f.actions.forEach((a, n) => {
        if (n) body.append(document.createElement("br"));
        body.append(el("span", "tool", "Cue "), document.createTextNode(describe(a)));
      });
      body.append(el("span", "ms", `${(f.ms / 1000).toFixed(1)} s`));
    }
    li.append(el("time", "", timeOf(f.at).replace(/\s?[AP]M$/i, "")), body);
    list.append(li);
  }
  while (list.children.length > 300) list.firstElementChild.remove();
  if (stick) list.scrollTop = list.scrollHeight;
}

function renderScreen(s) {
  const box = $("screen");
  box.replaceChildren();
  if (!s || !s.mode || s.mode === "idle") {
    box.append(el("div", "idle", "Listening quietly"));
  } else {
    box.append(el("p", "mode", s.mode));
    if (s.title) box.append(el("p", "title", s.title));
    if (s.url) box.append(el("p", "url", s.url));
    if (Array.isArray(s.bullets) && s.bullets.length) {
      const ul = el("ul", "bullets");
      for (const b of s.bullets.slice(0, 6)) ul.append(el("li", "", String(b)));
      box.append(ul);
    }
  }
  const flags = [s?.screenHidden && "screen hidden from the call", s?.audioMuted && "muted"].filter(Boolean);
  if (flags.length) box.append(el("p", "flags", flags.join(" · ")));
}

// Phases as a stepper (borrowed from Vercel's deployment steps): done, current, to come.
function renderStepper(st) {
  const at = st.phaseAt || {};
  const when = (p) => at[p] || (p === "left" && at.leaving);
  const current = STEPS.map(([p]) => Boolean(when(p))).lastIndexOf(true);
  $("stepper").replaceChildren(...STEPS.map(([p, label], i) => {
    let cls = i < current ? "done" : i === current ? "now" : "";
    if (i === current && st.phase === "error") cls = "failed";
    const li = el("li", cls, st.phase === "leaving" && p === "left" ? "Leaving" : label);
    li.append(el("time", "", when(p) ? shortTime(when(p)) : i < current ? "skipped" : " "));
    return li;
  }));
}

function render(st) {
  $("problems").replaceChildren(...st.problems.map((p) => el("div", `problem ${p.level}`, p.text)));

  const active = ACTIVE.has(st.phase);
  const started = st.phase !== "idle";
  $("hero").hidden = active;
  $("hero").classList.toggle("compact", started);
  $("heroTitle").textContent = started ? "Send Cue to another call" : "Put Cue in a call";
  $("fine").textContent = `Recall bills about $${st.rate.toFixed(2)} an hour while Cue is in. It leaves by itself after ${st.maxMinutes} minutes, or once everyone else has gone.`;
  $("sendBtn").disabled = st.problems.some((p) => p.level === "error");
  $("live").hidden = !started;
  $("statusCard").className = `card status ${st.phase}`;

  const wasIn = Boolean(st.phaseAt?.in_call);
  const [head, detail] = st.phase === "error" && !wasIn ? ["Cue couldn't get into the call", ""] : PHASE[st.phase] || [st.phase, ""];
  $("phaseText").textContent = head;
  $("phaseDetail").textContent = st.phase === "error" ? st.message : detail;
  $("meetingLabel").textContent = st.meetingUrl;
  renderStepper(st);

  const ms = st.sentAt ? (st.endedAt || st.now) - st.sentAt : 0;
  $("meters").hidden = !st.sentAt;
  $("elapsed").textContent = clock(ms);
  $("cost").textContent = `$${((ms / 3_600_000) * st.rate).toFixed(2)}`;
  $("costLabel").textContent = active ? "Cost so far" : "Cost";
  $("leavesLabel").textContent = active ? "Leaves by itself" : "Ended";
  $("leavesAt").textContent = active ? `in ${clock(st.sentAt + st.maxMinutes * 60_000 - st.now)}` : st.endedAt ? shortTime(st.endedAt) : "";
  $("leaveBtn").hidden = !st.botId || !active;
  $("leaveBtn").disabled = st.phase === "leaving";
  $("leaveBtn").textContent = st.phase === "leaving" ? "Leaving…" : "Take Cue out";

  const dot = { lobby: "busy", starting: "busy", joining: "busy", leaving: "busy", in_call: "ok", error: "bad" }[st.phase] || "";
  $("dot").className = `dot ${dot}`;
  document.title = active ? `${head} · Cue` : "Cue panel";

  $("steps").replaceChildren(...st.log.map((l) => { const li = el("li"); li.append(el("time", "", timeOf(l.at)), el("span", "", l.text)); return li; }));

  renderScreen(st.screen);
  renderFeed(st.feed);
  const list = $("feed");
  if (!list.children.length || list.querySelector(".empty")) {
    list.replaceChildren(empty(
      st.publicUrl && !st.tapped ? "Cue is using PUBLIC_URL, so its think calls skip the panel and nothing shows here."
        : st.phase === "in_call" ? "Listening. Lines show up here as people talk."
        : "What people say, and what Cue does about it, shows up here once Cue is in the call.",
    ));
  }
  // Like a finished build log: once Cue is out, nothing more arrives.
  $("feedEnd").hidden = active || !st.endedAt || !wasIn;
  $("screenCard").hidden = !wasIn;
  $("feedEnd").textContent = `Cue left at ${shortTime(st.endedAt || st.now)}. Nothing more is recorded.`;
}

async function poll() {
  try {
    const r = await fetch(`/api/state?since=${since}`);
    const st = await r.json();
    if (st.feed.length) since = st.feed.at(-1).id;
    render(st);
    $("conn").textContent = "";
  } catch {
    $("conn").textContent = "The panel process isn't answering. Is `npm run panel` still running?";
  }
  setTimeout(poll, 1000);
}

$("sendForm").onsubmit = async (e) => {
  e.preventDefault();
  $("sendBtn").disabled = true;
  try {
    await post("/api/send", { meetingUrl: $("meetingUrl").value });
    since = 0;
    $("feed").replaceChildren(empty(""));
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
