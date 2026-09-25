import { promises as fs } from "node:fs";
import path from "node:path";
import type { BotState } from "./types.js";

const STATE_DIR = path.join(process.cwd(), "state");
const STATE_FILE = path.join(STATE_DIR, "state.json");

const EMPTY_STATE: BotState = {
  notes: [],
  pendingDrafts: [],
  awaitingFeedbackForDraftId: null,
  ownerChatId: null,
};

let cache: BotState | null = null;

export async function loadState(): Promise<BotState> {
  if (cache) return cache;
  let loaded: BotState;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    loaded = { ...EMPTY_STATE, ...JSON.parse(raw) };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    loaded = { ...EMPTY_STATE };
  }
  cache = loaded;
  return cache;
}

export async function saveState(state: BotState): Promise<void> {
  cache = state;
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}
