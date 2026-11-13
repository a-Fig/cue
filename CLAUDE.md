# Cue: notes for Claude Code

A silent AI participant in video calls, built for a hackathon (started 2026-11-13). A Recall.ai bot
joins the call and streams `public/` as its screen share; that page reads the live transcript and
asks `/api/think` (Claude, with web search) what to show: research with highlights, slides, Mermaid
diagrams, videos, captions, pings. It never speaks. The README covers running it.

Cue is the product, the repo and the bot's name in the call (renamed from quiet-intern on
2026-11-13). "Intern" still describes its personality in the prompt, and "intern, …" still works as
a wake word next to "Cue, …", which transcripts may spell "Q" or "queue" (`WAKE` in `public/app.js`).

## Writing for whoever comes next

Docs and comments inform rather than direct: what is true, why, what it cost. Directions are
Tyler's rules. Facts that can go stale carry a date. This file loads into every session, so it
stays short.

## Layout

| Path | What |
|---|---|
| `server.js` | Node `http` server, no framework: serves `public/`, `POST /api/think`, `GET /api/page` (a page's readable text, for highlighting) |
| `agent.js` | The Claude call: system prompt, display tools, web search. Stateless, one call per transcript "tick"; returns its tokens, cost and time |
| `page.js` | A web page reduced to readable paragraphs, for `/api/page` and the replay |
| `public/` | The page the bot shows (`app.js`: transcript in, actions out). Plain ES modules, no build step |
| `scripts/cue.mjs` | `npm run cue`: starts the server and a tunnel if needed, sends the bot, takes it out again |
| `scripts/launch.mjs` | The start-up steps `cue.mjs` and `panel.mjs` share: server, tunnel, bot status |
| `scripts/panel.mjs`, `panel/` | `npm run panel`: the same from a page on 127.0.0.1 (#32), with a live feed from a local pass-through in front of `server.js`. Never public, never inside `server.js` |
| `scripts/send-bot.mjs`, `scripts/recall.mjs` | Sends the bot alone; Recall's bot API (create, status, leave) |
| `scripts/check.mjs` | The CI check: every JS file parses, the server boots and guards its API |
| `evals/` | `replay.mjs` runs the typed meetings in `transcripts/` through `think()` and scores when Cue acts and when it stays quiet (#10) |
| `brand/` | Cara's brand kit: colours (`tokens.css`), type, voice, logos. `public/` and `panel/` keep copies of its tokens and three logos, since only `public/` is served. Ask Cara before changing it |
| `.github/pr-media.mjs` | Uploads PR screenshots to the `pr-media` branch and prints the markdown for the PR body |
| `docs/VISION.md` | What Cue is for, what it holds to, and the open questions with their issues. A settled question's answer and reason go there, dated. It also compares Cue with Claude Meetings, the reference for judgment calls and design (Tyler, 2026-11-13) |

## Commands

```bash
npm start                                  # http://localhost:3000/?test=1&token=<AGENT_TOKEN>
npm run check                              # what CI runs, a few seconds, no keys needed
npm run cue -- <meeting-url>               # server + tunnel + bot, leaves on Ctrl+C or after 60 min; bills Recall
npm run panel                              # the same from http://127.0.0.1:3900; RECALL_API=<stand-in> tries it unbilled
npm run send-bot -- <meeting-url>          # the bot only; needs RECALL_API_KEY and a public PUBLIC_URL; bills Recall
node --env-file=.env evals/replay.mjs [filter]  # score the prompt on evals/transcripts/; every tick is a billed think call
```

`?test=1` replaces the meeting with a box for typing transcript lines. Mocking `/api/think` in
Playwright renders any view without a Claude key (how PR screenshots get made).

## Traps

- **Recall's page is not a normal browser tab** (Recall docs, 2026-11-13): 1280×720 at 15 fps,
  must be public HTTPS, and can't call localhost, so the API must be public too. Audio the page
  plays goes into the meeting. Bot Explorer gives DevTools on the page while the bot is in a call.
- **The first real Google Meet call (2026-11-13, #4) worked:** the `screenshare` output-media key
  shows the page as the bot's screen share, and `app.js`'s parsing of the in-bot transcript
  websocket gets the lines, though nobody has looked at a raw message yet (the page logs the first
  10 to the console, for Bot Explorer). Research turns took 10–13 s on Sonnet 5.5. The bot waits in
  Meet's lobby until someone admits it, and bills from joining until it leaves.
- **Still unverified:** whether page audio (pings, video sound) reaches the meeting, and whether
  YouTube plays from Recall's cloud IP or asks it to sign in. Direct `.mp4` links are safer.
- **Anyone who can open the page can spend the Claude key**, so the API checks `AGENT_TOKEN`.
  `/api/page` refuses internal addresses, but not DNS tricks.
- **Two systems** (#50, 2026-11-13): System 1 is Jev (`typesafe/jev-1.13` on OpenRouter's
  decisions API), which answers "act or stay quiet?" on each tick in ~0.2–0.9 s for ~$0.000015.
  System 2 is Claude, which decides what to show, and runs only when Jev isn't sure the answer is
  "quiet". It is on when `OPENROUTER_API_KEY` is set (`CUE_GATE=off` disables it). Being
  addressed skips it, and any error fails open to Claude. The server log shows `[system 1 jev …]`.
- The model is `claude-opus-5-5` at low effort (`CLAUDE_MODEL`, `CLAUDE_EFFORT`); every think
  call is billed. Sonnet 5.5 medium (2026-11-13 replay, #11): quiet tick ~$0.002 and 1.7 s,
  research ~$0.02 and 5.5 s, about $0.90 per projected hour; `evals/replay.mjs` prints both per kind of tick. Claude Code exports
  `CLAUDE_EFFORT=medium` in its own shell, and `node --env-file` never overrides a variable
  that's already set, so a server started from an agent's shell runs at medium whatever `.env`
  says (2026-11-13).
- Stopping a background `npm start` can leave its `node server.js` child holding port 3000, and
  the next start then fails. Find the listener's PID and stop it: `Get-NetTCPConnection
  -LocalPort 3000` on Windows, `lsof -iTCP:3000 -sTCP:LISTEN` on macOS and Linux.

## Who is on what

The split, as Tyler gave it on 2026-11-13. Issues are assigned to match.

| Who | Area | Issues |
|---|---|---|
| Tyler (`a-Fig`) | Getting Cue into a Google Meet call | #4, #12, #16 |
| Drew (`DhruvaKanna07`) | The agent: making it do what we want and be helpful in the meeting | #10, #11, #13, #14, #17, #18 |
| Cara (`tthy-working`) and the fourth member | The demo video, and whatever else comes up | #9 |

Google Meet is the call app to get working first.

## Issue labels

Copied from `a-Fig/murmur`. Every issue carries at least a kind label.

- `bug` / `Feature` / `Task` / `question`: the kind, spelled exactly so.
- `priority: now` / `soon` / `future`: open issues only, one of them. In a hackathon, `now` is
  "needed for the demo".
- `PR needed` / `non-PR needed`: where the work lives. `non-PR needed` means some of it is done by
  hand: an account, a key, a test in a real call, a decision.
- `from: <Model>`: see Workflow. `pending`: a closing PR is open.

Why an issue closed is its `state_reason`, not a label. No new label without a reason.

## Workflow

Tyler's rules from murmur and pi-vi, lightened for the hackathon (2026-11-13):

- Commit messages and PR bodies explain *why*.
- Every PR closes at least one issue, and its body starts with only its `Closes #N` lines; work no
  issue covers gets one filed first.
- PR bodies follow `.github/pull_request_template.md`; an agent opening a PR through `gh` writes
  those sections itself. A PR that changes what's on Cue's screen shows it: screenshots,
  or a GIF when it moves (`node .github/pr-media.mjs <pr> <files>` uploads them).
- Commits to `main` go through PRs; Tyler merges. CI must be green.
- Every PR that changes `server.js`, `agent.js` or the API gets an Opus or Sol review before it's
  handed over, and the body says which commits it covered. Docs, templates, styling,
  page-only (`public/`) changes, and renames or other mechanical edits (even in those files)
  skip review to keep things moving (Tyler, 2026-11-13).
- Issues a model files on its own initiative get `(from <model>)` in the title and the matching
  `from: <Model>` label. An issue Tyler asks for is `from: Tyler`, even though a model typed it.

<!-- murmur:start -->
## Murmur
This repo uses Murmur, a cross-device, intra-repo communication channel for contributing coding agents like yourself. If you have not joined Murmur yet, you should.

- To join Murmur (ask your user first): https://raw.githubusercontent.com/a-Fig/murmur/main/docs/agents/join.md
- To use Murmur: https://raw.githubusercontent.com/a-Fig/murmur/main/docs/agents/use.md
<!-- murmur:end -->
