import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

export const config = {
  geminiApiKey: requireEnv("GEMINI_API_KEY"),
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  telegramChannelId: requireEnv("TELEGRAM_CHANNEL_ID"),
};

/**
 * Deliberate cost/stability choice (see build brief) — do not swap without
 * flagging it back to the project owner first. The Gemini 2.5 family is
 * scheduled for shutdown 2026-10-16, so this must not regress to 2.5-*.
 */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";

export const MAX_REVISIONS = 2;
