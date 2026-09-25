import { Bot } from "grammy";
import { config } from "./config.js";
import { loadState, saveState } from "./state.js";
import {
  runGenerate,
  handleApprove,
  handleRejectStart,
  handleFeedbackReply,
  isAwaitingFeedback,
  recordNote,
  scheduleAutoGenerate,
  CHANNEL_CHAT_ID,
} from "./pipeline.js";
import { transcribeVoiceNote } from "./gemini.js";
import { downloadTelegramFile } from "./telegram-files.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    if (ctx.chat?.id !== CHANNEL_CHAT_ID) return;
    await ctx.reply(
      "I watch this channel and turn worth-it fragments into LinkedIn drafts.\n\nI'll draft automatically a couple of minutes after new notes stop coming in — no need to ask. Post /generate any time to check right now instead of waiting."
    );
  });

  bot.command("generate", async (ctx) => {
    if (ctx.chat?.id !== CHANNEL_CHAT_ID) return;
    await runGenerate(bot, ctx.chat.id);
  });

  // Everything happens in this one channel: raw notes, drafts, and reject
  // feedback all arrive here as channel posts. The Telegram Bot API only
  // surfaces channel messages in real time, so this listener has to be
  // running continuously to collect them.
  bot.on("channel_post", async (ctx) => {
    const post = ctx.channelPost;
    if (post.chat.id !== CHANNEL_CHAT_ID) {
      console.log(
        `[channel_post] ignored — from chat id ${post.chat.id}, but TELEGRAM_CHANNEL_ID resolves to ${CHANNEL_CHAT_ID}. If this is the right channel, fix TELEGRAM_CHANNEL_ID in .env (it must include the leading "-", e.g. -1001234567890) and restart.`
      );
      return;
    }

    let text = post.text ?? post.caption;

    // A free-text reply while a draft is awaiting a rejection reason is
    // feedback, not a new raw note.
    const state = await loadState();
    if (text && isAwaitingFeedback(state)) {
      await handleFeedbackReply(bot, post.chat.id, text);
      return;
    }

    // Telegram's Bot API has no transcript field for voice notes (that's a
    // client-side Premium feature, not available to bots) — so transcribe
    // it ourselves via Gemini's audio understanding instead.
    const voiceFile = post.voice ?? post.audio;
    if (!text && voiceFile) {
      const downloaded = await downloadTelegramFile(bot, voiceFile.file_id);
      if (downloaded) {
        text =
          (await transcribeVoiceNote(downloaded.base64, downloaded.mimeType)) ??
          undefined;
      }
    }

    if (!text) {
      console.log(
        `[skip] message #${post.message_id} has no text/caption and no usable transcript — skipping.`
      );
      return;
    }

    await recordNote({
      id: post.message_id,
      date: new Date(post.date * 1000).toISOString(),
      text,
      used: false,
    });
    scheduleAutoGenerate(bot);
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const [action, draftId] = data.split(":");
    await ctx.answerCallbackQuery();

    if (action === "approve") {
      await handleApprove(bot, chatId, draftId);
    } else if (action === "reject") {
      await handleRejectStart(bot, chatId, draftId);
    }
  });

  bot.catch((err) => {
    console.error("Unhandled bot error:", err.error);
  });

  return bot;
}

// Ensure state file exists on first run so reads never race an ENOENT.
export async function ensureStateInitialized(): Promise<void> {
  const state = await loadState();
  await saveState(state);
}
