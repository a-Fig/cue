# Cue

A silent AI participant for Zoom, Google Meet and Teams calls. It listens, never speaks, and helps through its shared screen:

- **Research:** opens a web page live and highlights the passages that answer the question.
- **Slides and diagrams:** turns the discussion into bullet slides or Mermaid diagrams as people talk.
- **Captions:** one-line messages to the room ("Found it: …").
- **Pings:** a short sound when it has something you asked for.
- **Videos:** plays a YouTube clip or `.mp4` for everyone, from a chosen timestamp.

Think of a very quiet, very helpful intern. Say "Cue, …" to ask it something directly ("intern, …" works too).

These spoken commands run instantly in the page, without waiting for the model: "Cue, mute" / "unmute", "Cue, stop the video", "Cue, hide your screen" / "show your screen". Start it muted with `?muted` on the page URL.

## How it works

```
meeting audio → Recall.ai bot (real-time transcript)
             → this page, running inside the bot as its screen share
             → /api/think: Claude (with web search) picks an action
             → page renders it; everyone in the call sees it
```

The bot comes from [Recall.ai](https://recall.ai) ("Output Media" streams a web page as the bot's screen share). The thinking is done by Claude.

## Run it

Requires Node 22+.

```bash
npm install
cp .env.example .env    # add ANTHROPIC_API_KEY, AGENT_TOKEN
npm start
```

Open `http://localhost:3000/?test=1&token=<AGENT_TOKEN>` and type transcript lines, or press **Demo script**. No meeting or Recall account is needed for this.

## Put it in a meeting

1. Make the server public over HTTPS, e.g. `cloudflared tunnel --url http://localhost:3000`, and set `PUBLIC_URL` in `.env`.
2. Add `RECALL_API_KEY` to `.env`.
3. `npm run send-bot -- https://meet.google.com/xxx-xxxx-xxx`

Recall streams the page at 1280×720 and 15 fps. Use its Bot Explorer to open DevTools on the page while the bot is in the call.

## Files

- `server.js`: serves the page; `/api/think` and `/api/page` (readable text of a page, for highlighting)
- `agent.js`: the Claude call, system prompt and display tools
- `public/`: the page the bot shows
- `scripts/send-bot.mjs`: creates the Recall bot
- `docs/VISION.md`: what Cue is for, and the questions still open
