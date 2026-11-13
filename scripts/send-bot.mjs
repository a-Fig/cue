// Send the intern into a meeting.
//   npm run send-bot -- <meeting-url>
// Needs RECALL_API_KEY, PUBLIC_URL and AGENT_TOKEN (see .env.example).
const meetingUrl = process.argv[2];
const { RECALL_API_KEY, PUBLIC_URL, AGENT_TOKEN = "", RECALL_REGION = "us-west-2", BOT_NAME = "Quiet Intern" } = process.env;

if (!meetingUrl || !RECALL_API_KEY || !PUBLIC_URL) {
  console.error("usage: npm run send-bot -- <meeting-url>   (set RECALL_API_KEY and PUBLIC_URL in .env)");
  process.exit(1);
}

const pageUrl = new URL(PUBLIC_URL);
pageUrl.searchParams.set("token", AGENT_TOKEN);
pageUrl.searchParams.set("name", BOT_NAME);

const body = {
  meeting_url: meetingUrl,
  bot_name: BOT_NAME,
  // The page is shown as the bot's screen share. Swap "screenshare" for
  // "camera" to show it in the bot's video tile instead.
  output_media: {
    screenshare: { kind: "webpage", config: { url: pageUrl.toString() } },
  },
  // Real-time transcription; the page reads it from Recall's in-bot websocket.
  recording_config: {
    transcript: {
      provider: { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } },
      diarization: { use_separate_streams_when_available: true },
    },
  },
};

const r = await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/`, {
  method: "POST",
  headers: { authorization: `Token ${RECALL_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const data = await r.json().catch(() => ({}));
if (!r.ok) {
  console.error(`Recall returned ${r.status}:`, JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log(`Bot ${data.id} is joining ${meetingUrl}`);
console.log("Admit it from the lobby if the meeting asks. Debug it live in Recall's Bot Explorer.");
