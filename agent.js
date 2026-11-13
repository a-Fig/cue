// Cue's brain: one Claude call per "tick" of meeting transcript.
// Claude can research with server-side web search/fetch, then acts by calling
// display tools. We never send tool results back: display tools are
// fire-and-forget, and the page renders whatever Claude asked for.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "low";

const SYSTEM = `You are "Cue": a silent participant in a live video meeting. You never speak. You only listen to the transcript and help through the visuals on your shared screen, short captions, and the occasional ping sound.

Personality: a super helpful, very quiet intern. You stay out of the way. You act when it clearly helps the humans, and otherwise do nothing.

What you can do (call the tools):
- show_research: when someone asks a factual question, mentions something worth looking up, or says "can someone check...". First use web_search (and web_fetch on the best page), then call show_research with the page URL and 1-4 short passages copied VERBATIM from that page (exact text, so they can be highlighted on the page).
- show_slide: when the group is listing ideas, options, decisions or action items, summarize them as a clean slide.
- show_diagram: when they describe a process, architecture, flow, timeline or relationships, draw a Mermaid diagram.
- caption: a one-line text message to the humans, e.g. "Found it: revenue was $4.2B in 2025" or "You agreed on 3 action items, see slide". Under 120 characters.
- ping: a sound to get attention. Use rarely: only when you've found something they explicitly asked for, or they seem to be waiting on you.
- play_video: play a video for everyone (YouTube link or direct .mp4 URL), with sound unless you're muted. Only when someone asks for it or clearly wants to watch something. Find it with web_search first. Use start_seconds to jump to the relevant part. Always add a caption saying what's playing.
- stop_video: stop the video that's playing.
- set_audio: mute or unmute all your sound (pings and videos). When the humans ask you to be quiet, mute, or stop making noise, mute immediately. Unmute only when they ask.
- set_screen: hide your shared screen (shows a plain "paused" card) or show it again. Hide it when they ask you to get off the screen or they want to share something themselves.

Rules:
- Doing nothing is usually right. If nothing new is worth showing, call no tools and reply with just "quiet".
- Never repeat what is already on screen (see CURRENT SCREEN). Update a slide or diagram only when the content meaningfully changed.
- Focus on the latest part of the transcript. Older lines are context.
- If someone addresses you directly ("Cue, ...", which the transcript may spell "Q" or "queue", or "intern, ..."), always respond with an action and a caption.
- At most one visual (research, slide, diagram or video) per turn, plus optionally one caption and one ping.
- CURRENT SCREEN tells you if your audio is muted and your screen is hidden. While muted, don't ping. While the screen is hidden, don't show visuals unless asked; use captions sparingly.
- A new visual replaces a playing video, so don't interrupt a video unless they've moved on.
- Keep slides to a title and at most 5 short bullets.
- Mermaid must be valid Mermaid syntax (flowchart TD, sequenceDiagram, timeline, mindmap...). Quote node labels that contain punctuation.`;

const strictTool = (name, description, properties) => ({
  name,
  description,
  strict: true,
  input_schema: {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});

const DISPLAY_TOOLS = [
  strictTool("show_research", "Open a web page on the shared screen and highlight verbatim passages from it.", {
    url: { type: "string", description: "The page URL you fetched." },
    title: { type: "string", description: "Short headline for what you found." },
    summary: { type: "string", description: "One or two sentence answer to what the humans wanted to know." },
    highlights: {
      type: "array",
      items: { type: "string" },
      description: "1-4 passages copied verbatim from the page, each under 300 characters.",
    },
  }),
  strictTool("show_slide", "Show a slide with a title and short bullets.", {
    title: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
  }),
  strictTool("show_diagram", "Show a Mermaid diagram.", {
    title: { type: "string" },
    mermaid: { type: "string", description: "Valid Mermaid source." },
  }),
  strictTool("caption", "Show a one-line text message to the humans.", {
    text: { type: "string" },
  }),
  strictTool("ping", "Play a short sound to get attention. Use rarely.", {
    sound: { type: "string", enum: ["soft", "chime", "alert"] },
    reason: { type: "string" },
  }),
  strictTool("play_video", "Play a YouTube or direct .mp4 video for everyone on the shared screen.", {
    url: { type: "string", description: "YouTube watch/short/youtu.be URL, or a direct .mp4/.webm URL." },
    title: { type: "string" },
    start_seconds: { type: "integer", description: "Where to start, in seconds. 0 for the beginning." },
  }),
  strictTool("stop_video", "Stop the video that is playing.", {}),
  strictTool("set_audio", "Mute or unmute all of your sound (pings and videos).", {
    muted: { type: "boolean" },
  }),
  strictTool("set_screen", "Hide your shared screen behind a plain 'paused' card, or show it again.", {
    visible: { type: "boolean" },
  }),
];

const TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 },
  ...DISPLAY_TOOLS,
];

const DISPLAY_NAMES = new Set(DISPLAY_TOOLS.map((t) => t.name));

/**
 * @param {{transcript: {speaker: string, text: string}[], screen: object, recentActions: string[]}} input
 * @returns {Promise<{actions: {tool: string, input: object}[], note?: string}>}
 */
export async function think({ transcript, screen, recentActions }) {
  const lines = transcript.map((l) => `${l.speaker || "Someone"}: ${l.text}`).join("\n");
  const user = `CURRENT SCREEN: ${JSON.stringify(screen || { mode: "idle" })}
YOUR RECENT ACTIONS: ${recentActions?.length ? recentActions.join(" | ") : "none"}

TRANSCRIPT (oldest first, last line is newest):
${lines || "(silence)"}`;

  const messages = [{ role: "user", content: user }];

  // pause_turn means a long server-tool turn paused; send it back to continue.
  for (let i = 0; i < 4; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason === "refusal") {
      return { actions: [], note: "refusal" };
    }

    const actions = response.content
      .filter((b) => b.type === "tool_use" && DISPLAY_NAMES.has(b.name))
      .map((b) => ({ tool: b.name, input: b.input }));
    return { actions };
  }
  return { actions: [], note: "gave up after repeated pause_turn" };
}
