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
} from "./pipeline.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await ctx.reply(
      "I watch your Skinstinct notes channel and turn worth-it fragments into LinkedIn drafts.\n\nUse /generate any time you want me to check for new notes and draft from them. I'll send each draft here with Approve / Reject buttons."
    );
  });

  bot.command("generate", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await runGenerate(bot, ctx.chat.id);
  });

  // Capture new notes from the private channel as they're posted. The
  // Telegram Bot API only surfaces channel messages in real time, so this
  // listener has to be running continuously to collect them — /generate
  // itself is still triggered manually, on demand.
  bot.on("channel_post", async (ctx) => {
    const post = ctx.channelPost;
    if (String(post.chat.id) !== config.telegramChannelId) return;

    const text = post.text ?? post.caption;
    if (!text) {
      console.log(
        `[skip] message #${post.message_id} has no text/caption (likely a voice note with no transcript) — skipping.`
      );
      return;
    }

    await recordNote({
      id: post.message_id,
      date: new Date(post.date * 1000).toISOString(),
      text,
      used: false,
    });
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

  // Free-text replies in the private chat are treated as rejection feedback
  // when a draft is waiting on a reason.
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const state = await loadState();
    if (!isAwaitingFeedback(state)) return;
    await handleFeedbackReply(bot, ctx.chat.id, ctx.message.text);
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
