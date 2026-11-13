// Recall's bot API, shared by send-bot.mjs, cue.mjs and panel.mjs.
const { RECALL_API_KEY = "", RECALL_REGION = "us-west-2", AGENT_TOKEN = "", BOT_NAME = "Cue" } = process.env;
// RECALL_API points the calls at a stand-in Recall, for trying the panel without billing.
const API = process.env.RECALL_API || `https://${RECALL_REGION}.recall.ai/api/v1/bot`;

// Posted to everyone when the bot joins, and pinned on Google Meet so later joiners see it (#15).
// Meet caps it at 500 characters. The idle screen says the same, for calls where the bot can't
// post in chat (Meet with continuous chat on and external chat blocked by the host's org).
const JOIN_NOTICE =
  `Hi, I'm ${BOT_NAME}, an AI assistant. I'm listening to this call and may show things on my shared screen; I never speak. ` +
  "Recall.ai transcribes the call, and the last few minutes go to AI models (Anthropic's Claude, and a small model through OpenRouter) to decide what to show. " +
  `To stop me, remove ${BOT_NAME} from the call.`;

async function call(method, path, body) {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { authorization: `Token ${RECALL_API_KEY}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Recall returned ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

/** Create a bot that joins meetingUrl and shows publicUrl as its screen share. */
export function createBot(meetingUrl, publicUrl) {
  if (!RECALL_API_KEY) throw new Error("RECALL_API_KEY is not set (see .env.example)");
  const pageUrl = new URL(publicUrl);
  pageUrl.searchParams.set("token", AGENT_TOKEN);
  pageUrl.searchParams.set("name", BOT_NAME);
  return call("POST", "", {
    meeting_url: meetingUrl,
    bot_name: BOT_NAME,
    // The page is shown as the bot's screen share. Swap "screenshare" for
    // "camera" to show it in the bot's video tile instead (#12).
    output_media: {
      screenshare: { kind: "webpage", config: { url: pageUrl.toString() } },
    },
    // Real-time transcription; the page reads it from Recall's in-bot websocket.
    // Recall leaves on its own about 2 s after everyone else has left the call.
    recording_config: {
      transcript: {
        provider: { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } },
        diarization: { use_separate_streams_when_available: true },
      },
      // Recall deletes the recording and transcript a day after the call (#15). Unset, accounts
      // made after 2025-06-12 keep them forever (Recall docs, 2026-11-13). null would keep
      // nothing, but then a call's transcript can't be downloaded afterwards for evals/.
      retention: { type: "timed", hours: 24 },
    },
    chat: { on_bot_join: { send_to: "everyone", message: JOIN_NOTICE, pin: true } },
  });
}

export const getBot = (id) => call("GET", `${id}/`);
export const leaveCall = (id) => call("POST", `${id}/leave_call/`);
