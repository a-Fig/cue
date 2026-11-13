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
- **Doing nothing is usually right.** A wrong or needless visual costs the whole room's
  attention. A missed chance costs nothing anyone notices.
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
| Telling the room | Appears as a participant and posts a notice in chat; the organizer is told to check everyone is fine with being transcribed | Appears as a participant named Cue; no notice (#15) |
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

## What is still open

These decide what Cue becomes. Each has an issue.

| Question | Issue | Needed for the demo |
|---|---|---|
| What is the demo? | #9 | yes |
| When does Cue act unprompted, and when does it stay quiet? | #10 | yes |
| How fast and how cheap does a think call need to be? | #11 | yes |
| Screen share or camera tile: where does Cue show things? | #12 | yes |
| How do people talk to Cue, and who may? | #13 | |
| How do we keep what Cue shows right, and safe for a room? | #14 | |
| What are people in the call told, and where do their words go? | #15 | |
| How does someone get Cue into their call? | #16 | |
| What else should Cue be able to show? | #18 | |
| What does Cue remember, and what is left after the call? | #17 | |

Before any of them can be answered well, Cue has to run in a real call (#4).

When one is settled, the answer and its reason go in this file, with the date.
