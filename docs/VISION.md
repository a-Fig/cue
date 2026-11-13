# Vision: a meeting participant that only shows

Status (2026-11-13): hackathon day one. Cue works in a test page with typed transcript lines and
mocked Claude answers. It has not been in a real call yet (#4). This is a first draft, written by
Fable from what Tyler said while building; where it says "Tyler", those are his words, and the
rest is open to his correction.

## The problem

People in a meeting are busy talking. When a question comes up that nobody can answer, someone
says "I'll look into it" and the answer arrives a day later, or someone stops listening to search
for it. When a plan takes shape, it exists only in what was said, and each person leaves with a
slightly different version.

A helper in the room could look things up and draw what is being described. But a helper that
talks has to interrupt, and voice assistants in calls get turned off for that.

## What Cue is

Cue joins a video call as a participant, listens, and never speaks. It helps through what it
shows on its shared screen.

Tyler, 2026-11-13: "I only want my agent to listen & show visuals. Nothing else." He described
it as a very silent intern who is super helpful.

The picture to hold (Tyler, 2026-11-13): "Think Joe Rogan asking his producers to pull up a
video or research something mid podcast." The host asks out loud without leaving the
conversation. A few seconds later the clip or the article is on a screen everyone can see, and
the talk carries on with it. The producer doesn't join the conversation. Cue is that producer,
for any meeting.

A screen can be ignored in a way a voice can't. People glance at it when they want to, which
lets Cue offer something without taking a turn in the conversation.

## What it does

1. **Research.** It opens a real web page and highlights the passages that answer the question,
   "for the humans who are busy talking" (Tyler). The source is on screen, so nobody has to take
   Cue's word.
2. **Slides and diagrams.** It turns what people are saying into bullets or a Mermaid diagram
   while they say it.
3. **Captions.** One line of text to the room.
4. **Pings.** A short sound, used rarely, when it has something people asked for.
5. **Videos.** It plays a YouTube clip or an `.mp4` for everyone.

People can mute it, stop a video, or hide its screen by saying so, and those commands work at
once, without waiting for the model.

## What it holds to

- **It never speaks.** Pings and a video's own sound are the only audio.
- **It acts unprompted, and holds back on chatter.** Cue is the intern running the meeting's
  projector (Tyler, 2026-11-13, #10): when something comes up that the room would want to see (a
  question wondered aloud, a guessed number, options with prices, a timeline said in words), it
  puts it up without being asked. "Cue, …" is a direct line, not the main way in. A needless
  visual still costs the whole room's attention, so reactions, jokes, status updates and
  anything already on screen get nothing.
- **Show the source.** Research is the page itself with the passage marked, not Cue's retelling.
- **The room is in charge.** Anyone can quiet it or clear its screen, immediately.

## Who it is for

For now: a small working meeting (a handful of people, in English) where questions of fact come
up and plans get described aloud. Google Meet comes first (Tyler, 2026-11-13); Recall also
covers Zoom and Teams, untried.

Not for: webinars and large calls, calls where a bot listening is unwelcome, or people who want
an assistant that answers aloud. Not a note-taker either: products that record and summarize
calls exist, and Cue's work happens during the call, on screen.

## A reference: Claude Meetings

Anthropic released Claude Meetings in beta on 2026-11-10: Claude joins a Google Meet call as a
participant. Tyler, 2026-11-13: it is something to refer to for judgment calls, design and ideas.
"We will be doing things differently but it's a good place to start."

What its announcement says
([claude.com](https://claude.com/resources/articles/claude-meetings), read 2026-11-13):

| | Claude Meetings | Cue today |
|---|---|---|
| Asking it | Out loud or in the call's chat | Out loud only (#13) |
| Answering | In writing, in the call's chat | On its shared screen |
| What it makes | Docs and whiteboards that people on the invite edit during the call; notes and action items | Pages with highlights, slides, diagrams, videos; view only |
| Joining | Someone adds it, or auto-join from the calendar | A command line (#16) |
| Telling the room | Appears as a participant and posts a notice in chat; the organizer is told to check everyone is fine with being transcribed | Appears as a participant named Cue, pins a notice in chat and shows one on its idle screen (#15) |
| Outside guests | Stays out by default, and leaves if one joins | No rule |
| Looking things up | Asks for approval before using a connected tool | Searches the public web without asking |
| After the call | A page per meeting with notes, transcript and what it built; no audio kept | Nothing (#17) |
| Call apps | Google Meet | Meet, Zoom and Teams, through Recall |

The announcement doesn't say how fast it answers, what its tile looks like, or when it acts
without being asked.

Where Cue differs on purpose (Tyler, 2026-11-13): Claude Meetings is focused on taking notes and
making plans, which are things to have after the call. Cue is "fully focused on being helpful
during the meeting, and never speaking." "We want to support humans": the people do the
talking, deciding and planning, and Cue helps them do it.

That shows in where the work lands. Claude Meetings puts its answers in the chat and its work in
documents people open elsewhere. Cue puts everything on a screen the whole room is already
looking at, so nobody leaves the call window.

It also weighs the open questions. What Cue keeps after a call (#17) matters least, and when it
acts and how fast (#10, #11) matter most. Where Cue has no reason to
differ (a notice on joining, chat as a second way in, a rule for guests), Claude Meetings'
choice is the default to start from.

## How it works

```
meeting audio → Recall.ai bot (live transcript)
             → Cue's page, running inside the bot as its screen share
             → /api/think: Claude, with web search, picks what to show
             → the page draws it; everyone in the call sees it
```

- **Recall.ai, not a bot of our own.** Joining Meet, Zoom and Teams as a participant is three
  separate hard problems. Recall does it and streams a web page as the bot's screen, so Cue is a
  web page and a small server.
- **The page is the product.** Everything people see is plain HTML in `public/`, with no build
  step. It can be opened in a browser with `?test=1` and fed typed lines, without a meeting.
- **One Claude call per look.** After a pause in speech, the page sends the last 4 minutes of
  transcript and what is on screen, and Claude answers with what to show, or nothing. The server
  keeps no state between calls.

## What is settled

### How fast, and how cheap (#11, 2026-11-13)

Proposed by Drew's agent from replay measurements; merging the PR that adds this accepts it.

- **Fast.** From the end of a spoken question to the answer on screen, nine times in ten: 8 s
  when someone asks Cue by name, 10 s when Cue steps in on its own (it first waits for a pause,
  in case a person answers). Slides, diagrams and captions: 4 s after the pause. Why: Tyler
  called 10 to 13 s of research "slow" in the first real call, and the producer picture has the
  answer up "a few seconds later", while the room is still on the question.
- **Cheap.** At most $2 of Claude per meeting hour; Recall bills for the bot on top. Why: it
  leaves room for a real call's longer transcript and a busier hour than the estimate below, and
  stays small next to the time of the people in the meeting.
- **Measured** (replay of 33 ticks, Sonnet 5.5 at medium effort, web search without a sandbox
  or fetch): research 5.4 s median and 5.7 s max for the Claude call, other visuals 2.1 s,
  quiet ticks 1.7 s at $0.002; about $0.90 for an hour of 360 ticks with 10 look-ups. Still
  unmeasured: Recall's transcript delay and the page fetch (about 1 s), which add to the call.
  Unprompted look-ups also wait 2.5 to 6.5 s for a pause before the call starts, so they meet
  10 s only at the quick end until the page checks for a pause more often than every 4 s.
- **System 1 decides whether to act, System 2 decides what to show** (#50, 2026-11-13). Jev,
  a System 1 decision model, reads the newest lines and answers "would showing something now
  help?" Only when it isn't confident the answer is no does Claude get the tick. In the replay
  (Sonnet 5.5 medium), Jev settled 10 of 22 quiet ticks by itself in ~230 ms at ~$0.00002, against
  1.6 s and $0.0019 for Claude, and it got none of them wrong and blocked no tick that needed
  action. Why a reflex: like the intern at the projector, most moments need no thought.

### What the room is told, and where its words go (#15, 2026-11-13)

Tyler's answers (2026-11-13, through eminent-stencil). Cue hears everything said in the call, so
the people in it are told, and this is where their words go.

| What | Goes to | Kept |
|---|---|---|
| The call's audio | Recall.ai, which transcribes it live | The recording and transcript, for 24 hours after the call (`retention` in `scripts/recall.mjs`). Left unset, Recall keeps them forever for accounts made after 2025-06-12 |
| The last 4 minutes of transcript, on every think call | Anthropic's API (Claude) | Deleted by Anthropic within 30 days by default; longer only if flagged under its Usage Policy or held for legal reasons |
| The same, instead, when `CUE_MODEL_PROVIDER=gemini` (#55) | Google's Gemini API, with Google Search grounding | Kept by Google for 55 days to check for abuse. On a project with billing on, not used to improve Google's products; on the free tier, it may be |
| The newest 12 lines, on each tick, when `OPENROUTER_API_KEY` is set | OpenRouter's decisions API, to Jev (System 1, #50), which one provider, TypeSafe, hosts | OpenRouter keeps no prompts or answers unless the account turns on its prompt logging, only token counts and timings. TypeSafe publishes no retention policy that OpenRouter's pages show, so what it keeps is unknown |
| Search terms Claude picks from what was said | Anthropic's web search and fetch tools | Under Anthropic's API terms, as above |
| Pages Cue highlights | Fetched by our server (`/api/page`) | Nothing |
| Our server's log | Stays on whichever machine runs it | Timings and tool names, never transcript text |

Sources, read 2026-11-13: Recall's
[storage and retention](https://docs.recall.ai/docs/data-retention) and
[chat messages](https://docs.recall.ai/docs/chat-messages) docs, and Anthropic's
[API data retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-commercial-api-data)
page. Read 2026-11-13 for the rest: OpenRouter's
[data collection](https://openrouter.ai/docs/guides/privacy/data-collection) page and
[Jev 1.13's page](https://openrouter.ai/typesafe/jev-1.13), and Google's Gemini API
[usage policies](https://aistudio.google.com/docs/usage-policies) and
[logs policy](https://ai.google.dev/gemini-api/docs/logs-policy).

How the room is told:

- **In the chat.** When the bot joins, it posts a notice to everyone and pins it on Google Meet,
  so people who join later see it too. This follows Claude Meetings' choice.
- **On its screen.** The idle screen says an AI is listening, where the words go, and how to stop
  it. This covers calls where the bot can't post in chat: Recall's docs say a bot can't on Meet
  when continuous chat is on and the host's organization blocks outside chat.
- **Stopping it.** Removing Cue from the call stops everything. "Cue, mute" only silences its
  sounds, and "Cue, hide your screen" only clears its screen; neither stops it listening. There
  is no "Cue, stop listening" yet.
- **The hackathon demo.** The join notice is enough; nobody is asked to agree in advance
  (Tyler, 2026-11-13).

## What is still open

These decide what Cue becomes. Each has an issue.

| Question | Issue | Needed for the demo |
|---|---|---|
| What is the demo? | #9 | yes |
| When does Cue act unprompted, and when does it stay quiet? | #10 | yes |
| Screen share or camera tile: where does Cue show things? | #12 | yes |
| How do people talk to Cue, and who may? | #13 | |
| How do we keep what Cue shows right, and safe for a room? | #14 | |
| How does someone get Cue into their call? | #16 | |
| What else should Cue be able to show? | #18 | |
| What does Cue remember, and what is left after the call? | #17 | |

Before any of them can be answered well, Cue has to run in a real call (#4).

When one is settled, the answer and its reason go in this file, with the date.
