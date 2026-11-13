// Replays typed meeting transcripts through agent.js's think() and scores what
// Cue does, for #10: when Cue acts unprompted and when it stays quiet.
//
//   node --env-file=.env evals/replay.mjs [name-filter[,name-filter...]]
//
// Every think call is billed (Opus by default, see CLAUDE_MODEL), about 25 per
// full run. Each transcript in evals/transcripts/ is a list of lines; a line
// with an `expect` is a tick: the moment the page would ask /api/think, after
// that line and everything before it. `expect` is what a person judged right:
//   "quiet"               Cue should do nothing at all
//   ["show_research",...] one of these tools should be called (captions and
//                         pings alongside are fine)
//   ["quiet", "add_notes"] either is right: a judgment call (quiet, or this tool)
//   "any"                 not scored (e.g. "Cue, mute", which the page handles)
// A tick may also have a `check`: a regex the actions' text must match (e.g. the
// right version number), or a helpful tool choice counts as "wrong" (#14).
// The judgments carry the vision's rule: a needless visual costs the whole
// room's attention, a missed chance costs little, so "annoying" counts double.
//
// Claude Code sets CLAUDE_EFFORT=medium in its own shell, and --env-file
// doesn't override it, so from an agent's shell pass CLAUDE_EFFORT=low
// explicitly or the run measures medium effort. The summary prints which ran.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchReadable } from "../page.js";
import { allFiller } from "../public/filler.js";

// REPLAY_AGENT=<path to an agent.js> replays another branch's prompt (say, a
// sibling worktree's) against these transcripts; the default is this checkout's.
const { think } = await import(process.env.REPLAY_AGENT
  ? pathToFileURL(path.resolve(process.env.REPLAY_AGENT)).href
  : "../agent.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const filters = (process.argv[2] || "").split(",");
const files = readdirSync(path.join(here, "transcripts"))
  .filter((f) => f.endsWith(".json") && filters.some((x) => f.includes(x)))
  .sort();

// What the page keeps between ticks (mirrors apply() in public/app.js).
function applyToState(st, { tool, input }) {
  const remember = (t) => { st.recentActions.push(t); st.recentActions = st.recentActions.slice(-6); };
  switch (tool) {
    case "show_slide": st.screen = { mode: "slide", ...input }; return remember(`slide (${input.layout}): ${input.title}`);
    case "show_diagram": st.screen = { mode: "diagram", title: input.title, mermaid: input.mermaid }; return remember(`diagram: ${input.title}`);
    case "add_notes": {
      // public/views/notes.js: repeats are dropped by their letters and digits; the
      // notes take the screen only when it's idle or on the notes, or when nothing
      // new was passed (a request to show them).
      const key = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      st.notes ||= { decisions: [], action_items: [], open_questions: [] };
      let added = 0;
      for (const [list, toKey] of [["decisions", key], ["action_items", (x) => key(x.task)], ["open_questions", key]]) {
        const seen = new Set(st.notes[list].map(toKey));
        for (const item of input[list] || []) {
          if (!toKey(item) || seen.has(toKey(item))) continue;
          seen.add(toKey(item)); st.notes[list].push(item); added++;
        }
      }
      const asked = !["decisions", "action_items", "open_questions"].some((l) => input[l]?.length);
      if (asked || ["idle", "notes"].includes(st.screen.mode)) st.screen = { mode: "notes" };
      return remember(asked ? "showed notes" : `notes: +${added}`);
    }
    case "show_comparison":
      st.screen = { mode: "comparison", title: input.title, options: input.options, criteria: input.rows.map((r) => r.criterion), pick: input.pick };
      return remember(`comparison: ${input.title}`);
    case "show_research": st.screen = { mode: "research", title: input.title, url: input.url }; return remember(`research: ${input.title}`);
    case "play_video": st.screen = { mode: "video", title: input.title, url: input.url }; return remember(`video: ${input.title}`);
    case "stop_video": st.screen = { mode: "idle" }; return remember("stopped video");
    case "caption": return remember(`caption: ${input.text}`);
    case "ping": return remember(`ping: ${input.sound}`);
    case "set_audio": st.muted = input.muted; return remember(input.muted ? "muted" : "unmuted");
    case "set_screen": st.hidden = !input.visible; return remember(input.visible ? "screen shown" : "screen hidden");
  }
}

function judge(expect, actions, check) {
  if (expect === "any") return "unscored";
  const tools = actions.map((a) => a.tool);
  if (expect === "quiet") return tools.length ? "annoying" : "right-quiet";
  if (!tools.length) return expect.includes("quiet") ? "right-quiet" : "missed";
  if (!tools.some((t) => expect.includes(t))) return "annoying";
  if (check && !new RegExp(check, "i").test(JSON.stringify(actions.map((a) => a.input)))) return "wrong";
  return "helpful";
}

// What a tick cost depends on what it did, so costs and latencies are split
// this way: research means the call searched or fetched the web.
function kindOf(result) {
  if (!result.usage) return result.note?.startsWith("skipped") ? "skipped" : "error";
  if (result.usage?.searches || result.usage?.fetches) return "research";
  return result.actions.length ? "acted" : "quiet";
}

// Research is only useful if the page can mark its quotes. This fetches the
// page as /api/page does and matches quotes as markParagraph() in
// public/app.js does: normalized, whole or by the first 60 characters.
const norm = (q) => q.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/[–—]/g, "-").toLowerCase().replace(/\s+/g, " ").trim();
async function highlightsFound({ url, highlights }) {
  try {
    const page = await fetchReadable(url);
    const paras = page.paragraphs.map(norm);
    const found = highlights.filter((h) => { const n = norm(h); return paras.some((p) => p.includes(n) || (n.length > 60 && p.includes(n.slice(0, 60)))); });
    return { found: found.length, of: highlights.length };
  } catch (e) {
    return { found: 0, of: highlights.length, error: e.message };
  }
}

function brief({ tool, input }) {
  if (tool === "add_notes") {
    const items = [...input.decisions, ...input.action_items.map((a) => `${a.owner}: ${a.task}`), ...input.open_questions];
    return `add_notes(${items.join("; ").slice(0, 90) || "show"})`;
  }
  const s = input.title || input.text || input.url || (tool === "set_audio" ? `muted=${input.muted}` : "");
  return s ? `${tool}(${String(s).slice(0, 70)})` : tool;
}

async function runTranscript(file) {
  const { about, lines } = JSON.parse(readFileSync(path.join(here, "transcripts", file), "utf8"));
  const st = { screen: { mode: "idle" }, muted: false, hidden: false, recentActions: [] };
  const ticks = [];
  let seen = 0; // lines before this index were in an earlier tick
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.expect === undefined) continue;
    const fresh = lines.slice(seen, i + 1);
    seen = i + 1;
    const t0 = Date.now();
    let result;
    // SKIP_FILLER=1 does what the page does: no call when every new line is filler.
    if (process.env.SKIP_FILLER && allFiller(fresh)) result = { actions: [], note: "skipped: filler" };
    else try {
      result = await think({
        transcript: lines.slice(0, i + 1).map(({ speaker, text }) => ({ speaker, text })),
        screen: { ...st.screen, audioMuted: st.muted, screenHidden: st.hidden, ...(st.notes && { notes: st.notes }) },
        recentActions: st.recentActions,
      });
    } catch (e) {
      result = { actions: [], note: `error: ${e.message}` };
    }
    const ms = Date.now() - t0;
    for (const a of result.actions) applyToState(st, a);
    const research = result.actions.find((a) => a.tool === "show_research");
    const marks = research ? await highlightsFound(research.input) : undefined;
    ticks.push({ after: `${line.speaker}: ${line.text}`, expect: line.expect, verdict: judge(line.expect, result.actions, line.check),
      actions: result.actions, note: result.note, ms, kind: kindOf(result), usage: result.usage, marks });
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
    const cost = t.usage ? ` $${t.usage.usd.toFixed(4)}` : "";
    console.log(`  ${t.verdict.padEnd(11)} ${String(t.ms).padStart(6)}ms${cost}  "${t.after.slice(0, 60)}"\n${" ".repeat(26)}want ${want}; got ${got}${t.marks ? ` [page marks ${t.marks.found}/${t.marks.of}${t.marks.error ? `: ${t.marks.error}` : ""}]` : ""}${t.note ? ` [${t.note}]` : ""}`);
  }
}
const n = (k) => count[k] || 0;
const scored = n("helpful") + n("right-quiet") + n("annoying") + n("missed") + n("wrong");
const all = runs.flatMap((r) => r.ticks).map((t) => t.ms).sort((a, b) => a - b);
// A wrong answer on screen is worse than a needless one: it looks like fact.
const score = n("helpful") + n("right-quiet") - 2 * n("annoying") - n("missed") - 2 * n("wrong");
console.log(`\nhelpful ${n("helpful")}, right-quiet ${n("right-quiet")}, annoying ${n("annoying")}, missed ${n("missed")}, wrong ${n("wrong")} of ${scored} scored ticks`);
console.log(`score ${score} (max ${scored}): helpful + right-quiet - 2*annoying - missed - 2*wrong`);
console.log(`latency median ${all[all.length >> 1]}ms, max ${all.at(-1)}ms; model ${process.env.CLAUDE_MODEL || "claude-opus-5-5"}, effort ${process.env.CLAUDE_EFFORT || "low"}`);

// Cost and latency by kind of tick, then an hour projected from them. The
// replays over-sample moments worth acting on, so the hour is built from the
// per-kind means and an assumed mix rather than from the replay's own mix:
// TICKS_PER_HOUR (default 360, one per 10 s of talk; the page looks every 4 s
// and thinks after a 2.5 s pause or 15 s of speech), of which
// RESEARCH_PER_HOUR (default 10) search and ACTED_PER_HOUR (default 10) show
// something without searching. Replay transcripts are short; a real tick
// carries up to 4 minutes of transcript, roughly 1k more input tokens.
const priced = runs.flatMap((r) => r.ticks).filter((t) => t.usage);
const byKind = {};
for (const t of priced) (byKind[t.kind] ||= []).push(t);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const kinds = {};
for (const [k, ts] of Object.entries(byKind)) {
  const ms = ts.map((t) => t.ms).sort((a, b) => a - b);
  const s = kinds[k] = { n: ts.length, usd: mean(ts.map((t) => t.usage.usd)), medianMs: ms[ms.length >> 1], maxMs: ms.at(-1),
    input: mean(ts.map((t) => t.usage.input + t.usage.cacheRead + t.usage.cacheWrite)), cached: mean(ts.map((t) => t.usage.cacheRead)),
    output: mean(ts.map((t) => t.usage.output)), searches: mean(ts.map((t) => t.usage.searches)), fetches: mean(ts.map((t) => t.usage.fetches)) };
  console.log(`${k.padEnd(8)} n=${String(s.n).padStart(2)}  median ${s.medianMs}ms, max ${s.maxMs}ms  $${s.usd.toFixed(4)}/tick  ` +
    `in ${Math.round(s.input)} (cached ${Math.round(s.cached)}) out ${Math.round(s.output)}  searches ${s.searches.toFixed(1)} fetches ${s.fetches.toFixed(1)}`);
}
const marked = priced.filter((t) => t.marks);
const marks = { found: marked.reduce((a, t) => a + t.marks.found, 0), of: marked.reduce((a, t) => a + t.marks.of, 0),
  pagesWithNone: marked.filter((t) => !t.marks.found).length, pages: marked.length };
if (marked.length) console.log(`research highlights the page can mark: ${marks.found}/${marks.of}; ${marks.pagesWithNone} of ${marks.pages} pages marked none`);
const total = priced.reduce((a, t) => a + t.usage.usd, 0);
const env = (k, d) => Number(process.env[k] || d);
const mix = { ticks: env("TICKS_PER_HOUR", 360), research: env("RESEARCH_PER_HOUR", 10), acted: env("ACTED_PER_HOUR", 10) };
const per = (k) => kinds[k]?.usd ?? kinds.quiet?.usd ?? 0;
const hourUsd = (mix.ticks - mix.research - mix.acted) * per("quiet") + mix.research * per("research") + mix.acted * per("acted");
console.log(`cost this run $${total.toFixed(3)} over ${priced.length} ticks; projected hour $${hourUsd.toFixed(2)} ` +
  `(${mix.ticks} ticks: ${mix.research} research, ${mix.acted} other visuals, the rest quiet)`);

mkdirSync(path.join(here, "runs"), { recursive: true });
const out = path.join(here, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: process.env.CLAUDE_EFFORT || "low", web: process.env.CLAUDE_WEB || "search", score, max: scored, count, kinds, marks, total, hour: { usd: hourUsd, ...mix }, runs }, null, 2));
console.log(`full run: ${path.relative(process.cwd(), out)}`);
