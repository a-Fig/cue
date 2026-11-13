// Running notes (#18): decisions, action items and open questions that build up through the call.
// Unlike a slide, which the next visual replaces, notes are kept for the whole call: each
// add_notes call appends only what is new, and the page drops repeats. Claude sees the full notes
// in CURRENT SCREEN while they are showing, and a one-line digest in its recent actions otherwise.
import { mountView, make, clip } from "./mount.js";

const notes = { decisions: [], action_items: [], open_questions: [] };
const SHOW = 6; // per column; older items fold into "+N earlier"

const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function addUnique(list, items, toKey) {
  const seen = new Set(list.map(toKey));
  const added = [];
  for (const item of items || []) {
    const k = toKey(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    list.push(item);
    added.push(item);
  }
  return added;
}

function column(el, items, fresh, render) {
  const ul = el.querySelector("ul");
  const shown = items.slice(-SHOW);
  ul.replaceChildren(...shown.map((item) => {
    const li = render(item);
    if (fresh.has(item)) li.classList.add("fresh");
    return li;
  }));
  el.querySelector(".earlier").textContent = items.length > SHOW ? `+${items.length - SHOW} earlier` : "";
  el.querySelector(".count").textContent = items.length || "";
  el.classList.toggle("empty", !items.length);
}

/** @param {{decisions: string[], action_items: {task: string, owner: string}[], open_questions: string[]}} input */
export function addNotes(input, view) {
  const el = mountView("notes", `
    <h1>Meeting notes</h1>
    <div class="notes-grid">
      <div class="col decisions"><h2>Decided <span class="count"></span></h2><ul></ul><p class="earlier"></p><p class="none">Nothing yet</p></div>
      <div class="col actions"><h2>Action items <span class="count"></span></h2><ul></ul><p class="earlier"></p><p class="none">Nothing yet</p></div>
      <div class="col questions"><h2>Open questions <span class="count"></span></h2><ul></ul><p class="earlier"></p><p class="none">Nothing yet</p></div>
    </div>`);

  const d = addUnique(notes.decisions, (input.decisions || []).map((s) => clip(s, 110)), key);
  const a = addUnique(notes.action_items,
    (input.action_items || []).map((x) => ({ task: clip(x.task, 90), owner: clip(x.owner, 24) })),
    (x) => key(x.task));
  const q = addUnique(notes.open_questions, (input.open_questions || []).map((s) => clip(s, 110)), key);
  const fresh = new Set([...d, ...a, ...q]);

  column(el.querySelector(".decisions"), notes.decisions, fresh, (s) => make("li", "", s));
  column(el.querySelector(".actions"), notes.action_items, fresh, ({ task, owner }) => {
    const li = make("li");
    li.append(make("span", "owner", owner || "Someone"), make("span", "task", task));
    return li;
  });
  column(el.querySelector(".questions"), notes.open_questions, fresh, (s) => make("li", "", s));

  view.show("notes");
  view.screen({ mode: "notes", ...notes });
  const parts = [d.length && `+${d.length} decided`, a.length && `+${a.length} action`, q.length && `+${q.length} question`].filter(Boolean);
  view.remember(`notes (${notes.decisions.length} decided, ${notes.action_items.length} actions, ${notes.open_questions.length} open): ${parts.join(", ") || "nothing new"}`);
}
