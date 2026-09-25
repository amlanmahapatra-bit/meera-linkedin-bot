import { createBot, ensureStateInitialized } from "./bot.js";
import { loadState } from "./state.js";
import { triggerGenerate } from "./pipeline.js";

async function main() {
  await ensureStateInitialized();
  const bot = createBot();

  // If the process restarted while notes were still unprocessed (e.g. it
  // crashed or got redeployed), catch up immediately rather than waiting for
  // the next channel post.
  const state = await loadState();
  if (state.notes.some((n) => !n.used)) {
    await triggerGenerate(bot);
  }

  console.log("Starting bot (long polling)...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running. Just post notes to the channel — drafts and Approve/Reject will show up there too.`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
