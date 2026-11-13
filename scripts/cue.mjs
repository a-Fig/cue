// Put Cue in a meeting with one command, and take it out again.
//   npm run cue -- <meeting-url>
//
// Starts the server unless one is already running on PORT. Uses PUBLIC_URL when it serves
// Cue's page; otherwise opens a cloudflared quick tunnel, whose address changes every run.
// Then it sends the bot and reports what it does. The bot leaves on Ctrl+C, after
// CUE_MAX_MINUTES (60 by default), or on its own once everyone else has left the call
// (Recall's default). A bot left behind keeps billing, so if this process is killed hard,
// remove it from Recall's dashboard. `npm run panel` does the same from a local web page.
import { createBot, leaveCall } from "./recall.mjs";
import { STATUS, publicUrl, startServer, watchBot } from "./launch.mjs";

const meetingUrl = process.argv[2];
const PORT = Number(process.env.PORT || 3000);
const MAX_MINUTES = Number(process.env.CUE_MAX_MINUTES || 60);

if (!meetingUrl || !/^https?:\/\//.test(meetingUrl)) {
  console.error("usage: npm run cue -- <meeting-url>   (e.g. https://meet.google.com/abc-defg-hij)");
  process.exit(1);
}

const children = [];
const say = (msg) => console.log(`[cue] ${msg}`);

let botId;
let leaving = false;
async function leave(why) {
  if (leaving) return;
  leaving = true;
  say(`${why}: taking Cue out of the call…`);
  try {
    if (botId) await leaveCall(botId);
  } catch (err) {
    // Already gone, most often. Anything else: the bot may still be billing.
    say(`couldn't remove the bot (${err.message}); check Recall's dashboard`);
  }
}

function shutdown(code) {
  for (const c of children) c?.kill();
  process.exit(code);
}

let interrupts = 0;
process.on("SIGINT", async () => {
  if (++interrupts > 1) shutdown(130); // second Ctrl+C: stop without waiting
  await leave("Ctrl+C");
});

try {
  // Pass through the server's think lines, so the terminal shows what Cue decides.
  children.push(await startServer({ port: PORT, say, onLine: (l) => console.log(`  ${l}`) }));
  const tunnel = await publicUrl(`http://localhost:${PORT}`, say);
  children.push(tunnel.child);
  const bot = await createBot(meetingUrl, tunnel.url);
  botId = bot.id;
  say(`bot ${botId} sent to ${meetingUrl}. It leaves after ${MAX_MINUTES} min, or on Ctrl+C.`);
  setTimeout(() => leave(`${MAX_MINUTES} minutes are up`), MAX_MINUTES * 60_000).unref();

  await watchBot(botId, (now) => say((STATUS[now.code] || now.code) + (now.sub_code ? ` (${now.sub_code})` : "")));
  shutdown(0);
} catch (err) {
  say(err.message);
  if (botId) await leave("error");
  shutdown(1);
}
