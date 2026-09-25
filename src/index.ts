import { createBot, ensureStateInitialized } from "./bot.js";

async function main() {
  await ensureStateInitialized();
  const bot = createBot();

  console.log("Starting bot (long polling)...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running. Send /generate in a private chat with it.`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
