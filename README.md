# Skinstinct LinkedIn Content Bot

A Telegram bot for Meera Pillai (founder, Skinstinct). It watches her private
Telegram notes channel, decides which fragments are substantive enough to
become a LinkedIn post, drafts the post in her voice, and posts the draft
back into that same channel for approval — with inline Approve / Reject
buttons. Rejecting a draft with a reason (posted as a reply in the channel)
triggers a revision. Everything — raw notes, drafts, approvals, feedback —
happens in the one channel; there's no separate private chat to manage.

It never posts to LinkedIn and never runs unattended end-to-end — every
draft needs her explicit approval. There's no database: state is a single
local JSON file.

## How it works

```
Telegram channel  --channel_post-->  bot records the note, then immediately:
                                              |
                  Step A: Gemini worth-it filter (voice skill = rubric)
                                              |
                     Step B: Gemini drafts post (voice skill + note +
                             best-effort current-events grounding)
                                              |
              Bot posts the draft back to the channel with Approve / Reject buttons
                                              |
                Approve -> done, nothing else happens
                Reject + reason -> Step C: Gemini revises (max 2 rounds)
```

There is **no fixed-interval scheduler** — this isn't used on a recurring
cadence. Instead, it's purely event-driven: every new note triggers the
pipeline immediately, no waiting. `/generate` also works any time, for an
on-demand re-check (e.g. if the process was offline when a note came in).
The bot process does need to stay running continuously — Telegram's Bot API
only delivers channel messages in real time as they're posted, so it has to
be online to capture new notes as they come in. In this project it runs
under `pm2` (see below) so it survives crashes and machine restarts.

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
   - `TELEGRAM_CHANNEL_ID` — the numeric id of Meera's private notes channel.
     **Must include the leading minus sign** — real Telegram channel/supergroup
     ids look like `-1001234567890`, not `1001234567890`. If it's wrong, the
     bot silently ignores every post from the channel (it now logs the actual
     chat id it's seeing when this happens, so check the console output if
     nothing seems to react). The bot must also be added to the channel
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
needs to keep running continuously (Telegram only delivers channel posts in
real time; there's nothing to backfill if the bot was offline when a note
was posted, aside from `/generate`, which only catches notes still marked
unprocessed).

### Running it continuously (pm2)

For a note to always trigger processing — not just while a terminal happens
to be open — the process needs to survive terminal closes, crashes, and
machine restarts. This project runs under [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2 pm2-windows-startup   # pm2-windows-startup is Windows-only
npm run build
pm2 start dist/index.js --name meera-linkedin-bot --cwd "/path/to/this/project"
pm2 save                # persist the process list
pm2-startup install     # Windows: auto-launch pm2 (and this bot) on login
```

Useful commands: `pm2 status`, `pm2 logs meera-linkedin-bot`, `pm2 restart meera-linkedin-bot`
(needed after any code or `.env` change, since pm2 runs the built `dist/`
output), `pm2 stop meera-linkedin-bot`.

## Using it

Everything below happens inside the one channel — no private chat with the
bot is needed at any point.

- **Automatically:** once running, the bot records every text (or captioned)
  message posted to the channel — voice notes too, transcribed via Gemini's
  audio understanding, since Telegram's Bot API has no transcript field of
  its own (voice-to-text there is a client-side Premium feature, not
  something bots can read) — and, right after each note, automatically:
  1. Pulls every note posted since the last run (usually just the one that
     triggered it, but catches up on anything still unprocessed too).
  2. Asks Gemini to cluster related notes and decide, per cluster, whether
     it's worth turning into a post (using the five-beat structure from
     `context/meera-voice-skill.md` as the rubric). Every note is marked
     processed either way, so nothing gets evaluated twice.
  3. For each cluster judged worth it, fetches a best-effort current-events
     reference and drafts a LinkedIn post in Meera's voice, then posts it
     back to the channel with **Approve** / **Reject** buttons and a note on
     which source message(s) it came from.
  A voice note is logged as skipped, rather than failing the run, only if
  the audio turns out empty or unintelligible. A thin, purely instructional,
  or off-voice note (e.g. "write me a post about X") is correctly filtered
  out at step 2 rather than forced into a draft — that's the worth-it filter
  working as intended, not a bug.
- **On demand:** post `/generate` to the channel any time to force an
  immediate re-check anyway (e.g. if the bot was offline when a note landed).
- **Approve:** the draft is marked done. The bot takes no further action —
  posting to LinkedIn is entirely manual, by design.
- **Reject:** the bot asks why, in the channel. Reply with your reason as a
  normal text post, and it regenerates the draft using that feedback, the
  original note(s), and the same voice skill. Capped at 2 revision rounds —
  after that it tells you it's out of revisions and asks if you want to
  handle it manually rather than looping forever.

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
src/gemini.ts                  Gemini calls: worth-it filter, transcription, grounding, draft, revise
src/telegram-files.ts          Downloads a Telegram file (e.g. a voice note) for transcription
src/pipeline.ts                Orchestrates the filter -> ground -> draft -> revise flow
src/bot.ts                     Telegram handlers (channel_post, /generate, buttons, feedback)
src/index.ts                   Entry point — starts the bot
state/state.json               Local state (gitignored, created on first run)
```
