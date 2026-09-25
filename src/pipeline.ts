import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { loadState, saveState } from "./state.js";
import {
  evaluateNotes,
  fetchGroundingReference,
  draftPost,
  revisePost,
} from "./gemini.js";
import { config, MAX_REVISIONS } from "./config.js";
import type { NoteRecord, PendingDraft, BotState } from "./types.js";

let voiceSkillCache: string | null = null;
async function getVoiceSkill(): Promise<string> {
  if (voiceSkillCache) return voiceSkillCache;
  const p = path.join(process.cwd(), "context", "meera-voice-skill.md");
  voiceSkillCache = await readFile(p, "utf-8");
  return voiceSkillCache;
}

function draftKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve", `approve:${draftId}`)
    .text("Reject", `reject:${draftId}`);
}

async function clearKeyboard(
  bot: Bot,
  chatId: number,
  messageId: number | undefined
): Promise<void> {
  if (!messageId) return;
  try {
    await bot.api.editMessageReplyMarkup(chatId, messageId, {});
  } catch {
    // Message may already be edited or too old to edit — not worth failing over.
  }
}

export function isAwaitingFeedback(state: BotState): boolean {
  return state.awaitingFeedbackForDraftId !== null;
}

export async function recordNote(note: NoteRecord): Promise<void> {
  const state = await loadState();
  state.notes.push(note);
  await saveState(state);
}

/** Everything — raw notes, drafts, approval, feedback — happens in this one channel. */
export const CHANNEL_CHAT_ID = Number(config.telegramChannelId);

/** Runs the pipeline against the notes channel — called right after a new note arrives. */
export async function triggerGenerate(bot: Bot): Promise<void> {
  await runGenerate(bot, CHANNEL_CHAT_ID);
}

export async function runGenerate(bot: Bot, chatId: number): Promise<void> {
  const state = await loadState();
  const unprocessed = state.notes.filter((n) => !n.used);

  if (unprocessed.length === 0) {
    await bot.api.sendMessage(chatId, "No new notes since the last check.");
    return;
  }

  await bot.api.sendMessage(
    chatId,
    `Looking through ${unprocessed.length} new note(s)...`
  );

  const voiceSkill = await getVoiceSkill();
  const notesBlock = unprocessed
    .map((n) => `[id:${n.id}] (${n.date}) ${n.text}`)
    .join("\n\n");

  let decisions;
  try {
    decisions = await evaluateNotes(notesBlock, voiceSkill);
  } catch (err) {
    console.error("evaluateNotes failed:", err);
    await bot.api.sendMessage(
      chatId,
      "Something went wrong while evaluating the notes. Nothing was marked as processed — try /generate again."
    );
    return;
  }

  // Mark every note in this batch as processed regardless of the worth-it
  // call, so the same note is never evaluated twice.
  for (const note of unprocessed) {
    note.used = true;
  }

  let draftsSent = 0;
  for (const decision of decisions) {
    console.log(
      `[worth-it] theme="${decision.theme}" notes=${JSON.stringify(
        decision.sourceNoteIds
      )} worthIt=${decision.worthIt} reasoning="${decision.reasoning}"`
    );

    if (!decision.worthIt) continue;

    const sourceNotes = unprocessed.filter((n) =>
      decision.sourceNoteIds.includes(n.id)
    );
    if (sourceNotes.length === 0) continue;

    const sourceText = sourceNotes
      .map((n) => `(${n.date}) ${n.text}`)
      .join("\n\n");

    const groundingRef = await fetchGroundingReference(decision.theme);

    let draftText: string;
    try {
      draftText = await draftPost({ voiceSkill, sourceText, groundingRef });
    } catch (err) {
      console.error("draftPost failed for theme", decision.theme, err);
      continue;
    }

    const draft: PendingDraft = {
      id: randomUUID(),
      theme: decision.theme,
      sourceNoteIds: decision.sourceNoteIds,
      sourceText,
      groundingRef,
      draftText,
      revisionCount: 0,
      status: "awaiting_approval",
      createdAt: new Date().toISOString(),
    };
    state.pendingDrafts.push(draft);

    const header = `From: ${decision.sourceNoteIds
      .map((id) => `#${id}`)
      .join(", ")} — "${decision.theme}"`;

    const sent = await bot.api.sendMessage(
      chatId,
      `${header}\n\n${draft.draftText}`,
      { reply_markup: draftKeyboard(draft.id) }
    );
    draft.telegramMessageId = sent.message_id;
    draftsSent++;
  }

  await saveState(state);

  if (draftsSent === 0) {
    await bot.api.sendMessage(
      chatId,
      "None of the new notes looked substantive enough for a post this round."
    );
  }
}

export async function handleApprove(
  bot: Bot,
  chatId: number,
  draftId: string
): Promise<void> {
  const state = await loadState();
  const draft = state.pendingDrafts.find((d) => d.id === draftId);
  if (!draft) {
    await bot.api.sendMessage(chatId, "Couldn't find that draft anymore.");
    return;
  }
  draft.status = "approved";
  await saveState(state);
  await clearKeyboard(bot, chatId, draft.telegramMessageId);
  await bot.api.sendMessage(
    chatId,
    `Approved: "${draft.theme}". No further action from me — it's yours to post.`
  );
}

export async function handleRejectStart(
  bot: Bot,
  chatId: number,
  draftId: string
): Promise<void> {
  const state = await loadState();
  const draft = state.pendingDrafts.find((d) => d.id === draftId);
  if (!draft) {
    await bot.api.sendMessage(chatId, "Couldn't find that draft anymore.");
    return;
  }
  state.awaitingFeedbackForDraftId = draftId;
  draft.status = "awaiting_feedback";
  await saveState(state);
  await clearKeyboard(bot, chatId, draft.telegramMessageId);
  await bot.api.sendMessage(
    chatId,
    `What's wrong with the "${draft.theme}" draft? Reply with your reason and I'll revise it.`
  );
}

export async function handleFeedbackReply(
  bot: Bot,
  chatId: number,
  feedback: string
): Promise<void> {
  const state = await loadState();
  const draftId = state.awaitingFeedbackForDraftId;
  if (!draftId) return;

  const draft = state.pendingDrafts.find((d) => d.id === draftId);
  if (!draft) {
    state.awaitingFeedbackForDraftId = null;
    await saveState(state);
    return;
  }

  if (draft.revisionCount >= MAX_REVISIONS) {
    draft.status = "out_of_revisions";
    state.awaitingFeedbackForDraftId = null;
    await saveState(state);
    await bot.api.sendMessage(
      chatId,
      `Out of revisions on "${draft.theme}" (max ${MAX_REVISIONS}). Want to handle this one manually?`
    );
    return;
  }

  await bot.api.sendMessage(chatId, "Revising...");

  const voiceSkill = await getVoiceSkill();
  let revised: string;
  try {
    revised = await revisePost({
      voiceSkill,
      sourceText: draft.sourceText,
      groundingRef: draft.groundingRef,
      previousDraft: draft.draftText,
      feedback,
    });
  } catch (err) {
    console.error("revisePost failed:", err);
    await bot.api.sendMessage(
      chatId,
      "Something went wrong while revising. Try again, or reply with feedback once more."
    );
    return;
  }

  draft.draftText = revised;
  draft.revisionCount += 1;
  draft.status = "awaiting_approval";
  state.awaitingFeedbackForDraftId = null;
  await saveState(state);

  const header = `From: ${draft.sourceNoteIds
    .map((id) => `#${id}`)
    .join(", ")} — "${draft.theme}" (revision ${draft.revisionCount})`;

  const sent = await bot.api.sendMessage(
    chatId,
    `${header}\n\n${draft.draftText}`,
    { reply_markup: draftKeyboard(draft.id) }
  );
  draft.telegramMessageId = sent.message_id;
  await saveState(state);
}
