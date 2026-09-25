import { createBot, ensureStateInitialized } from "./bot.js";
import { loadState } from "./state.js";
import { scheduleAutoGenerate } from "./pipeline.js";

async function main() {
  await ensureStateInitialized();
  const bot = createBot();

  // If the process restarted mid-debounce, there may already be unprocessed
  // notes waiting — pick the auto-generate timer back up rather than waiting
  // for the next channel post to schedule it.
  const state = await loadState();
  if (state.notes.some((n) => !n.used)) {
    scheduleAutoGenerate(bot);
  }

  console.log("Starting bot (long polling)...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running. Send /start in a private chat with it, then just post notes to the channel.`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
