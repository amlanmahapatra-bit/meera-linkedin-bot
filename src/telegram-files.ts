import type { Bot } from "grammy";
import { config } from "./config.js";

/**
 * Downloads a Telegram file (e.g. a voice note) and returns it as base64.
 * The download URL embeds the bot token, so it's never logged or thrown in
 * an error message here.
 */
export async function downloadTelegramFile(
  bot: Bot,
  fileId: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) return null;

    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Telegram file download failed with status ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = file.file_path.split(".").pop()?.toLowerCase();
    const mimeType =
      ext === "oga" || ext === "ogg"
        ? "audio/ogg"
        : ext === "mp3"
          ? "audio/mp3"
          : ext === "m4a"
            ? "audio/aac"
            : "audio/ogg";

    return { base64: buffer.toString("base64"), mimeType };
  } catch (err) {
    console.error("Telegram file download failed:", err);
    return null;
  }
}
