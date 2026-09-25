import { GoogleGenAI, Type } from "@google/genai";
import { config, GEMINI_MODEL } from "./config.js";
import type { ClusterDecision } from "./types.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const CLUSTER_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      theme: { type: Type.STRING },
      sourceNoteIds: { type: Type.ARRAY, items: { type: Type.NUMBER } },
      worthIt: { type: Type.BOOLEAN },
      reasoning: { type: Type.STRING },
    },
    required: ["theme", "sourceNoteIds", "worthIt", "reasoning"],
  },
};

/**
 * Step A — for each new note (or cluster of related notes), decide whether
 * it's substantive enough to become a LinkedIn post, using the voice skill's
 * five-beat structure as the rubric.
 */
export async function evaluateNotes(
  notesBlock: string,
  voiceSkill: string
): Promise<ClusterDecision[]> {
  const prompt = `${voiceSkill}

---

TASK: You are the "worth-it filter" for Meera Pillai's raw Telegram notes.

Below is a batch of new, unprocessed notes from her channel. Each note is
tagged with its message id and timestamp. Related notes (same theme, same
week) may be clustered into a single group — a single week's fragments can
cluster around one theme.

For each group you identify, decide whether it is substantive enough to
become a LinkedIn post, using the five-beat structure above as the rubric:
does the note contain, or plausibly support, a claim/scene, a complication,
a mechanism with real specifics, room for an honest caveat, and a
generalizable takeaway? Thin, purely personal, or purely promotional
fragments should be filtered out (worthIt: false), not forced into a draft.

Every note id must appear in exactly one group. Give each group a short
theme label and a short reasoning string explaining the worthIt call (this
is for debugging, not for the reader).

NOTES:
${notesBlock}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: CLUSTER_RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) return [];
  return JSON.parse(text) as ClusterDecision[];
}

/**
 * Transcribes a voice note. The Telegram Bot API has no transcript field
 * (client-side voice-to-text is a Telegram Premium UI feature, not exposed
 * to bots), so this uses Gemini's own audio understanding on the downloaded
 * file instead. Returns null if the audio is empty/unintelligible so the
 * caller can fall back to logging it as skipped rather than failing.
 */
export async function transcribeVoiceNote(
  audioBase64: string,
  mimeType: string
): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Transcribe this voice note verbatim, in the language it was spoken in. Reply with only the transcript text, nothing else. If the audio is empty, silent, or not intelligible speech, reply with exactly: NONE",
            },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        },
      ],
    });
    const text = response.text?.trim();
    if (!text || text === "NONE") return null;
    return text;
  } catch (err) {
    console.error("Voice note transcription failed:", err);
    return null;
  }
}

/**
 * Best-effort current-events grounding for a note's topic. Returns null if
 * no good reference is found — a forced, irrelevant reference is worse than
 * none, and the voice never fabricates a source.
 */
export async function fetchGroundingReference(
  topic: string
): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Find one real, current, specific reference point (a news
item, an industry data point, or a recent study) relevant to this topic:
"${topic}"

Reply with just the reference itself in 1-2 sentences (what it is, the
source, and any concrete number/date), named conversationally, not
formally cited. If you cannot find a genuinely relevant, real, verifiable
reference, reply with exactly: NONE`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const text = response.text?.trim();
    if (!text || text === "NONE") return null;
    return text;
  } catch (err) {
    console.error("Grounding lookup failed, proceeding without it:", err);
    return null;
  }
}

interface DraftParams {
  voiceSkill: string;
  sourceText: string;
  groundingRef: string | null;
}

/** Step B — draft a LinkedIn post in Meera's voice from a note/cluster. */
export async function draftPost(params: DraftParams): Promise<string> {
  const { voiceSkill, sourceText, groundingRef } = params;
  const prompt = `${voiceSkill}

---

TASK: Write a LinkedIn post draft in Meera Pillai's voice, following the
five-beat skeleton (Section 10) directly. Follow every rule in the voice
skill above exactly — vocabulary, rhythm, the mandatory "here's what I'm
not saying" caveat, the generalized non-pitch close, no bullets, no
bolding, no emoji, no hashtags.

SOURCE NOTE(S) (Meera's raw, unedited Telegram fragments):
${sourceText}

${
  groundingRef
    ? `CURRENT-EVENTS GROUNDING REFERENCE (use this to ground beat 3 if it fits naturally; do not force it if it doesn't):\n${groundingRef}`
    : "No current-events grounding reference was found — do not fabricate one. Ground the post in the note's own specifics instead."
}

If the source note doesn't convincingly support all five beats, compress or
lightly skip a beat rather than forcing it. Never fabricate specific
numbers, studies, or sources that aren't present in the note or the
grounding reference above — if a number would strengthen the post but
isn't available, leave a bracketed placeholder like [X%] instead of
inventing one.

Output ONLY the post text. No preamble, no title, no explanation.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return (response.text ?? "").trim();
}

interface ReviseParams extends DraftParams {
  previousDraft: string;
  feedback: string;
}

/** Step C — revise a rejected draft using Meera's feedback. */
export async function revisePost(params: ReviseParams): Promise<string> {
  const { voiceSkill, sourceText, groundingRef, previousDraft, feedback } =
    params;
  const prompt = `${voiceSkill}

---

TASK: Revise a LinkedIn post draft that Meera rejected. Keep everything
that follows the voice skill above; fix what her feedback flags. Still
follow the five-beat skeleton (Section 10) and every voice rule exactly.

SOURCE NOTE(S):
${sourceText}

${
  groundingRef
    ? `CURRENT-EVENTS GROUNDING REFERENCE (use if it still fits naturally):\n${groundingRef}`
    : "No current-events grounding reference was found — do not fabricate one."
}

PREVIOUS DRAFT:
${previousDraft}

MEERA'S FEEDBACK ON WHY SHE REJECTED IT:
${feedback}

Never fabricate specific numbers, studies, or sources that aren't present
in the note or the grounding reference. Output ONLY the revised post text.
No preamble, no title, no explanation.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return (response.text ?? "").trim();
}
