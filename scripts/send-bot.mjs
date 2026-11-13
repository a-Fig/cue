// Send Cue into a meeting, given a server that is already public at PUBLIC_URL.
//   npm run send-bot -- <meeting-url>
// Needs RECALL_API_KEY, PUBLIC_URL and AGENT_TOKEN (see .env.example).
// `npm run cue -- <meeting-url>` does this plus the server, the tunnel and leaving.
import { createBot } from "./recall.mjs";

const meetingUrl = process.argv[2];
const { PUBLIC_URL } = process.env;
if (!meetingUrl || !PUBLIC_URL) {
  console.error("usage: npm run send-bot -- <meeting-url>   (set RECALL_API_KEY and PUBLIC_URL in .env)");
  process.exit(1);
}

try {
  const bot = await createBot(meetingUrl, PUBLIC_URL);
  console.log(`Bot ${bot.id} is joining ${meetingUrl}`);
  console.log("Admit it from the lobby if the meeting asks. Debug it live in Recall's Bot Explorer.");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
