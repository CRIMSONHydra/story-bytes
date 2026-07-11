/**
 * Query understanding (M10, RAG D7). One cheap Flash-Lite call turns a raw (possibly follow-up)
 * question into a self-contained query plus retrieval aids, replacing the brittle substring
 * intent hacks (`detectSummaryIntent`/`detectForeshadowingIntent`) and giving the hybrid arms a
 * cleaner signal.
 *
 * Fail-OPEN (for retrieval only): on any model/parse failure we fall back to the raw query and a
 * neutral intent. This never affects spoiler safety — the boundary is enforced downstream in SQL,
 * regardless of what the rewrite produced.
 */

import { generateJson } from './llm';
import { LITE_MODEL } from '../config/models';
import { logger } from './logger';

export type QueryIntent = 'recall' | 'summary' | 'foreshadowing' | 'theory';

export interface RewrittenQuery {
  /** Self-contained query with follow-up pronouns resolved from history. */
  standaloneQuery: string;
  /** Up to 3 decomposed sub-queries for multi-hop questions (empty for simple ones). */
  subQueries: string[];
  /** Proper-noun mentions (characters/places/factions) to strengthen the keyword arm. */
  entityMentions: string[];
  /** Detected intent — drives mode/pipeline selection instead of substring matching. */
  intent: QueryIntent;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const INTENTS: QueryIntent[] = ['recall', 'summary', 'foreshadowing', 'theory'];

const fallback = (query: string): RewrittenQuery => ({
  standaloneQuery: query,
  subQueries: [],
  entityMentions: [],
  intent: 'recall',
});

const SYSTEM = `You rewrite a reader's question about a story into a retrieval plan. You are given the
latest question and (optionally) recent conversation turns. Return STRICT JSON:
{"standaloneQuery": string,        // the question rewritten to stand alone (resolve "he/she/it/that"
                                   //   using the history); keep it faithful, do not add facts
 "subQueries": string[],           // 0-3 focused sub-questions for multi-hop queries, else []
 "entityMentions": string[],       // proper nouns (people/places/factions) mentioned, else []
 "intent": "recall"|"summary"|"foreshadowing"|"theory"}
Intent guide: "summary"/recap/"what happened so far" → summary; hints/symbolism/"what could X mean"/
setup → foreshadowing; fan theories/speculation/external sources → theory; otherwise recall.
Never answer the question. Only produce the plan.`;

/**
 * Rewrite a query into a retrieval plan. `explicitIntent` (when the caller passed a non-recall mode)
 * wins over the model's guess so an explicit UI mode is always honored.
 */
export const rewriteQuery = async (
  query: string,
  history: ChatTurn[] = [],
  explicitIntent?: QueryIntent,
): Promise<RewrittenQuery> => {
  try {
    const historyText = history.length
      ? `Recent turns:\n${history.slice(-6).map((t) => `${t.role}: ${t.content}`).join('\n')}\n\n`
      : '';
    const parsed = await generateJson(`${historyText}Latest question: ${query}`, {
      model: LITE_MODEL,
      systemInstruction: SYSTEM,
      usageContext: 'rewrite',
    });
    if (!parsed) return withIntent(fallback(query), explicitIntent);

    const result: RewrittenQuery = {
      standaloneQuery: typeof parsed.standaloneQuery === 'string' && parsed.standaloneQuery.trim()
        ? parsed.standaloneQuery.trim() : query,
      subQueries: Array.isArray(parsed.subQueries)
        ? parsed.subQueries.filter((s): s is string => typeof s === 'string').slice(0, 3) : [],
      entityMentions: Array.isArray(parsed.entityMentions)
        ? parsed.entityMentions.filter((s): s is string => typeof s === 'string').slice(0, 10) : [],
      intent: INTENTS.includes(parsed.intent as QueryIntent) ? (parsed.intent as QueryIntent) : 'recall',
    };
    return withIntent(result, explicitIntent);
  } catch (err) {
    logger.error({ err }, 'Query rewrite failed (non-fatal; using raw query)');
    return withIntent(fallback(query), explicitIntent);
  }
};

/** An explicit non-recall mode from the UI always overrides the model's intent guess. */
const withIntent = (r: RewrittenQuery, explicit?: QueryIntent): RewrittenQuery =>
  explicit && explicit !== 'recall' ? { ...r, intent: explicit } : r;
