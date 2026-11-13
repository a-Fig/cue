// Replays typed meeting transcripts through agent.js's think() and scores what
// Cue does, for #10: when Cue acts unprompted and when it stays quiet.
//
//   node --env-file=.env evals/replay.mjs [name-filter]
//
// Every think call is billed (Opus by default, see CLAUDE_MODEL), about 25 per
// full run. Each transcript in evals/transcripts/ is a list of lines; a line
// with an `expect` is a tick: the moment the page would ask /api/think, after
// that line and everything before it. `expect` is what a person judged right:
//   "quiet"               Cue should do nothing at all
//   ["show_research",...] one of these tools should be called (captions and
//                         pings alongside are fine)
//   "any"                 not scored (e.g. "Cue, mute", which the page handles)
// The judgments carry the vision's rule: a needless visual costs the whole
// room's attention, a missed chance costs little, so "annoying" counts double.
//
// Claude Code sets CLAUDE_EFFORT=medium in its own shell, and --env-file
// doesn't override it, so from an agent's shell pass CLAUDE_EFFORT=low
// explicitly or the run measures medium effort. The summary prints which ran.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { think } from "../agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";
const files = readdirSync(path.join(here, "transcripts"))
  .filter((f) => f.endsWith(".json") && f.includes(filter))
  .sort();

// What the page keeps between ticks (mirrors apply() in public/app.js).
function applyToState(st, { tool, input }) {
  const remember = (t) => { st.recentActions.push(t); st.recentActions = st.recentActions.slice(-6); };
  switch (tool) {
    case "show_slide": st.screen = { mode: "slide", title: input.title, bullets: input.bullets }; return remember(`slide: ${input.title}`);
    case "show_diagram": st.screen = { mode: "diagram", title: input.title, mermaid: input.mermaid }; return remember(`diagram: ${input.title}`);
    case "show_research": st.screen = { mode: "research", title: input.title, url: input.url }; return remember(`research: ${input.title}`);
    case "play_video": st.screen = { mode: "video", title: input.title, url: input.url }; return remember(`video: ${input.title}`);
    case "stop_video": st.screen = { mode: "idle" }; return remember("stopped video");
    case "caption": return remember(`caption: ${input.text}`);
    case "ping": return remember(`ping: ${input.sound}`);
    case "set_audio": st.muted = input.muted; return remember(input.muted ? "muted" : "unmuted");
    case "set_screen": st.hidden = !input.visible; return remember(input.visible ? "screen shown" : "screen hidden");
  }
}

function judge(expect, actions) {
  if (expect === "any") return "unscored";
  const tools = actions.map((a) => a.tool);
  if (expect === "quiet") return tools.length ? "annoying" : "right-quiet";
  if (!tools.length) return "missed";
  return tools.some((t) => expect.includes(t)) ? "helpful" : "annoying";
}

function brief({ tool, input }) {
  const s = input.title || input.text || input.url || (tool === "set_audio" ? `muted=${input.muted}` : "");
  return s ? `${tool}(${String(s).slice(0, 70)})` : tool;
}

async function runTranscript(file) {
  const { about, lines } = JSON.parse(readFileSync(path.join(here, "transcripts", file), "utf8"));
  const st = { screen: { mode: "idle" }, muted: false, hidden: false, recentActions: [] };
  const ticks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.expect === undefined) continue;
    const t0 = Date.now();
    let result;
    try {
      result = await think({
        transcript: lines.slice(0, i + 1).map(({ speaker, text }) => ({ speaker, text })),
        screen: { ...st.screen, audioMuted: st.muted, screenHidden: st.hidden },
        recentActions: st.recentActions,
      });
    } catch (e) {
      result = { actions: [], note: `error: ${e.message}` };
    }
    const ms = Date.now() - t0;
    for (const a of result.actions) applyToState(st, a);
    ticks.push({ after: `${line.speaker}: ${line.text}`, expect: line.expect, verdict: judge(line.expect, result.actions),
      actions: result.actions, note: result.note, ms });
  }
  return { file, about, ticks };
}

// One at a time: in parallel, calls queue behind the key's rate limit and the
// latencies stop meaning anything (2 s quiet ticks read as 10-30 s, 2026-11-13).
const runs = [];
for (const f of files) runs.push(await runTranscript(f));
const count = {};
for (const r of runs) {
  console.log(`\n== ${r.file}: ${r.about}`);
  for (const t of r.ticks) {
    count[t.verdict] = (count[t.verdict] || 0) + 1;
    const got = t.actions.map(brief).join(", ") || "quiet";
    const want = Array.isArray(t.expect) ? t.expect.join("|") : t.expect;
    console.log(`  ${t.verdict.padEnd(11)} ${String(t.ms).padStart(6)}ms  "${t.after.slice(0, 60)}"\n${" ".repeat(26)}want ${want}; got ${got}${t.note ? ` [${t.note}]` : ""}`);
  }
}
const n = (k) => count[k] || 0;
const scored = n("helpful") + n("right-quiet") + n("annoying") + n("missed");
const all = runs.flatMap((r) => r.ticks).map((t) => t.ms).sort((a, b) => a - b);
const score = n("helpful") + n("right-quiet") - 2 * n("annoying") - n("missed");
console.log(`\nhelpful ${n("helpful")}, right-quiet ${n("right-quiet")}, annoying ${n("annoying")}, missed ${n("missed")} of ${scored} scored ticks`);
console.log(`score ${score} (max ${scored}): helpful + right-quiet - 2*annoying - missed`);
console.log(`latency median ${all[all.length >> 1]}ms, max ${all.at(-1)}ms; model ${process.env.CLAUDE_MODEL || "claude-opus-5-5"}, effort ${process.env.CLAUDE_EFFORT || "low"}`);

mkdirSync(path.join(here, "runs"), { recursive: true });
const out = path.join(here, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ score, max: scored, count, runs }, null, 2));
console.log(`full run: ${path.relative(process.cwd(), out)}`);
