// Running notes (#18): decisions, action items and open questions that build up through the call.
// Unlike a slide, which the next visual replaces, notes are kept for the whole call: each
// add_notes call appends only what is new, and the page drops repeats. Every think call carries
// the full notes (currentNotes, in CURRENT SCREEN), so Claude can avoid reworded repeats even
// while another visual is up. Adding to the notes takes the screen only when nothing else is on
// it; an add_notes call with nothing new shows them, if someone just mentioned the notes.
import { mountView, make, clip } from "./mount.js";

const notes = { decisions: [], action_items: [], open_questions: [] };
const SHOW = 8; // most per column; fewer when long items wrap, and the rest fold into "+N earlier"

const key = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The notes so far, for the think request; undefined until there are any. */
export function currentNotes() {
  const n = notes.decisions.length + notes.action_items.length + notes.open_questions.length;
  return n ? structuredClone(notes) : undefined;
}

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

// Newest first, so the item just added is always on screen; then drop the oldest from the bottom
// until the column fits (long items wrap to two or three lines at this width).
function column(el, items, fresh, render) {
  const ul = el.querySelector("ul");
  const earlier = el.querySelector(".earlier");
  ul.replaceChildren(...items.slice(-SHOW).reverse().map((item) => {
    const li = render(item);
    if (fresh.has(item)) li.classList.add("fresh");
    return li;
  }));
  el.querySelector(".count").textContent = items.length || "";
  el.classList.toggle("empty", !items.length);
  const label = () => {
    const hidden = items.length - ul.children.length;
    earlier.textContent = hidden > 0 ? `+${hidden} earlier` : "";
  };
  label();
  while (ul.children.length > 1 && ul.scrollHeight > ul.clientHeight) {
    ul.lastElementChild.remove();
    label();
  }
}

const owners = new Map(); // owner → avatar colour, in the order they first got a task: blue, lime, ink

// "Sam" → "SA", "Priya Patel" → "PP": the owner as an avatar, like a call app's tiles.
const initials = (name) => {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words.at(-1)[0] : name.slice(0, 2)).toUpperCase();
};

/** @param {{decisions: string[], action_items: {task: string, owner: string}[], open_questions: string[]}} input */
export async function addNotes(input, view) {
  const el = await mountView("notes", `
    <h1>Meeting notes</h1>
    <div class="notes-grid">
      <div class="col actions"><h2>Action items <span class="count"></span></h2><ul></ul><p class="earlier"></p><p class="none">Nothing yet</p></div>
      <div class="col decisions"><h2>Decided <span class="count"></span></h2><ul></ul><p class="earlier"></p><p class="none">Nothing yet</p></div>
      <div class="col questions"><h2>Open questions <span class="count"></span></h2><ul></ul><p class="earlier"></p><p class="none">Nothing yet</p></div>
    </div>`);
  el.classList.add("sheet");

  const d = addUnique(notes.decisions, (input.decisions || []).map((s) => clip(s, 110)), key);
  const a = addUnique(notes.action_items,
    (input.action_items || []).map((x) => ({ task: clip(x.task, 90), owner: clip(x.owner, 24) })),
    (x) => key(x.task));
  const q = addUnique(notes.open_questions, (input.open_questions || []).map((s) => clip(s, 110)), key);
  const fresh = new Set([...d, ...a, ...q]);

  column(el.querySelector(".decisions"), notes.decisions, fresh, (s) => make("li", "", s));
  column(el.querySelector(".actions"), notes.action_items, fresh, ({ task, owner }) => {
    const li = make("li");
    const who = owner || "Someone";
    if (!owners.has(who)) owners.set(who, owners.size % 3);
    const av = make("span", `owner c${owners.get(who)}`, initials(who));
    av.title = who;
    li.append(make("span", "box"), make("span", "task", task), av);
    return li;
  });
  column(el.querySelector(".questions"), notes.open_questions, fresh, (s) => make("li", "", s));

  // Take the screen only when it's free, or when asked to show the notes (nothing new passed).
  // A decision spoken mid-video or mid-diagram shouldn't pull that away.
  // An empty call means "show the notes", but the replay (#10) caught the model sending one on
  // "back to the budget" and "thanks everyone", so it counts only when someone just said "notes".
  const empty = ![input.decisions, input.action_items, input.open_questions].some((l) => l?.length);
  if (empty && !view.heard(/\bnotes?\b/i)) return;
  const shown = empty || ["idle", "notes"].includes(view.mode());
  if (shown) {
    view.show("notes");
    view.screen({ mode: "notes" }); // the notes themselves travel in every request (currentNotes)
  }
  const parts = [d.length && `+${d.length} decided`, a.length && `+${a.length} action`, q.length && `+${q.length} question`].filter(Boolean);
  view.remember(`notes (${notes.decisions.length} decided, ${notes.action_items.length} actions, ${notes.open_questions.length} open): ${parts.join(", ") || "shown"}${shown ? "" : ", not shown"}`);
}
