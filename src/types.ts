export interface NoteRecord {
  /** Telegram message_id of the channel post. */
  id: number;
  /** ISO timestamp of when the note was posted. */
  date: string;
  text: string;
  used: boolean;
}

export type DraftStatus =
  | "awaiting_approval"
  | "awaiting_feedback"
  | "approved"
  | "out_of_revisions";

export interface PendingDraft {
  id: string;
  theme: string;
  sourceNoteIds: number[];
  sourceText: string;
  groundingRef: string | null;
  draftText: string;
  revisionCount: number;
  status: DraftStatus;
  createdAt: string;
  /** Telegram message_id of the draft message sent to Meera, if sent. */
  telegramMessageId?: number;
}

export interface BotState {
  notes: NoteRecord[];
  pendingDrafts: PendingDraft[];
  /** Draft id currently waiting on a free-text rejection reason, if any. */
  awaitingFeedbackForDraftId: string | null;
  /** Meera's private chat id with the bot, captured on /start, used to send auto-generated drafts. */
  ownerChatId: number | null;
}

export interface ClusterDecision {
  theme: string;
  sourceNoteIds: number[];
  worthIt: boolean;
  reasoning: string;
}
