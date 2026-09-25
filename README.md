# Skinstinct LinkedIn Content Bot

A Telegram bot for Meera Pillai (founder, Skinstinct). It watches her private
Telegram notes channel, decides which fragments are substantive enough to
become a LinkedIn post, drafts the post in her voice, and sends the draft
back to her on Telegram for approval — with inline Approve / Reject buttons.
Rejecting a draft with a reason triggers a revision.

It never posts to LinkedIn and never runs unattended end-to-end — every
draft needs her explicit approval. There's no database: state is a single
local JSON file.

## How it works

```
Telegram channel  --channel_post-->  bot collects & stores new notes locally
                                              |
                                      Meera sends /generate
                                              |
                  Step A: Gemini worth-it filter (voice skill = rubric)
                                              |
                     Step B: Gemini drafts post (voice skill + note +
                             best-effort current-events grounding)
                                              |
                  Bot sends draft to Meera with Approve / Reject buttons
                                              |
                Approve -> done, nothing else happens
                Reject + reason -> Step C: Gemini revises (max 2 rounds)
```

There is **no scheduler**. This is used from time to time, not on a fixed
cadence, so the only trigger is the manual `/generate` command. The bot
process does need to stay running continuously, though — Telegram's Bot API
only delivers channel messages in real time as they're posted, so the bot
has to be online to capture new notes as they come in. It doesn't act on
them until you ask it to with `/generate`.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in the three values (never commit
   `.env` — it's already gitignored):
   ```bash
   cp .env.example .env
   ```
   - `GEMINI_API_KEY` — from Google AI Studio.
   - `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather).
   - `TELEGRAM_CHANNEL_ID` — the numeric id of Meera's private notes channel
     (looks like `-1001234567890`). The bot must be added to that channel
     **as an admin** — the Bot API only delivers channel posts to bots that
     are channel admins.
3. Run it:
   ```bash
   npm run dev
   ```
   or build and run the compiled version:
   ```bash
   npm run build
   npm start
   ```

The bot uses long polling, so no public URL or webhook is needed — it just
needs to keep running (a terminal, a `screen`/`tmux` session, or a small
always-on machine/VM all work).

## Using it

- **Automatically, in the background:** once running, the bot silently
  records every text (or captioned) message posted to the channel. Pure
  voice notes with no transcript are logged as skipped rather than failing
  the run.
- **On demand:** message the bot privately and send `/generate`. It will:
  1. Pull every note posted since the last `/generate` run.
  2. Ask Gemini to cluster related notes and decide, per cluster, whether
     it's worth turning into a post (using the five-beat structure from
     `context/meera-voice-skill.md` as the rubric). Every note is marked
     processed either way, so nothing gets evaluated twice.
  3. For each cluster judged worth it, fetch a best-effort current-events
     reference and draft a LinkedIn post in Meera's voice, then send it back
     with **Approve** / **Reject** buttons and a note on which source
     message(s) it came from.
- **Approve:** the draft is marked done. The bot takes no further action —
  posting to LinkedIn is entirely manual, by design.
- **Reject:** the bot asks why. Reply with your reason as a normal text
  message, and it regenerates the draft using that feedback, the original
  note(s), and the same voice skill. Capped at 2 revision rounds — after
  that it tells you it's out of revisions and asks if you want to handle it
  manually rather than looping forever.

## Notes on the voice skill file

`context/meera-voice-skill.md` is loaded in full (never summarized or
truncated) as grounding for both the filtering and drafting Gemini calls.
Edit that file directly if her voice or structure needs to evolve — the code
never regenerates or rewrites it.

## Model

All Gemini calls use `gemini-3.1-flash-lite` (set in `src/config.ts`) — a
deliberate cost choice on the free tier. Don't swap it for a more expensive
model without checking back with the project owner first.

## Project structure

```
context/meera-voice-skill.md   Voice skill, loaded verbatim by the pipeline
src/config.ts                  Env var loading + validation, model constant
src/types.ts                   Shared TypeScript types
src/state.ts                   Local JSON state (read/write), no database
src/gemini.ts                  Gemini calls: worth-it filter, grounding, draft, revise
src/pipeline.ts                Orchestrates the filter -> ground -> draft -> revise flow
src/bot.ts                     Telegram handlers (channel_post, /generate, buttons, feedback)
src/index.ts                   Entry point — starts the bot
state/state.json               Local state (gitignored, created on first run)
```
