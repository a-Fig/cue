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
| `agent.js` | The Claude call: system prompt, display tools, web search/fetch. Stateless, one call per transcript "tick" |
| `public/` | The page the bot shows (`app.js`: transcript in, actions out). Plain ES modules, no build step |
| `scripts/send-bot.mjs` | Creates the Recall bot for a meeting URL |
| `scripts/check.mjs` | The CI check: every JS file parses, the server boots and guards its API |
| `docs/VISION.md` | What Cue is for, what it holds to, and the open questions with their issues. A settled question's answer and reason go there, dated. It also compares Cue with Claude Meetings, the reference for judgment calls and design (Tyler, 2026-11-13) |

## Commands

```bash
npm start                                  # http://localhost:3000/?test=1&token=<AGENT_TOKEN>
npm run check                              # what CI runs, a few seconds, no keys needed
npm run send-bot -- <meeting-url>          # needs RECALL_API_KEY and a public PUBLIC_URL; bills Recall
```

`?test=1` replaces the meeting with a box for typing transcript lines. Mocking `/api/think` in
Playwright renders any view without a Claude key (how PR screenshots get made).

## Traps

- **Recall's page is not a normal browser tab** (Recall docs, 2026-11-13): 1280×720 at 15 fps,
  must be public HTTPS, and can't call localhost, so the API must be public too. Audio the page
  plays goes into the meeting. Bot Explorer gives DevTools on the page while the bot is in a call.
- **Unverified in a real call so far:** the in-bot transcript websocket's message shape (`app.js`
  parses it defensively), the `screenshare` output-media key (Recall's example shows `camera`),
  and YouTube playback, which may ask a cloud IP to sign in. Direct `.mp4` links are safer.
- **Anyone who can open the page can spend the Claude key**, so the API checks `AGENT_TOKEN`.
  `/api/page` refuses internal addresses, but not DNS tricks.
- The model is `claude-opus-5-5` at low effort (`CLAUDE_MODEL`, `CLAUDE_EFFORT`); every think
  call is billed, and research calls take several seconds.

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
