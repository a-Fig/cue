// Recall's bot API, shared by send-bot.mjs and cue.mjs.
const { RECALL_API_KEY = "", RECALL_REGION = "us-west-2", AGENT_TOKEN = "", BOT_NAME = "Cue" } = process.env;
const API = `https://${RECALL_REGION}.recall.ai/api/v1/bot`;

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
    },
  });
}

export const getBot = (id) => call("GET", `${id}/`);
export const leaveCall = (id) => call("POST", `${id}/leave_call/`);
