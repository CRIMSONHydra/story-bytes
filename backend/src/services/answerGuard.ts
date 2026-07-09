/**
 * Answer guard — payoff-leak mode (plan §2.14.4, M10b).
 *
 * Given generated prose and a set of spoiler payoff summaries the reader must not learn yet, decide
 * whether the prose reveals or lets the reader infer any of them. Used by the foreshadowing chat
 * mode as a runtime backstop against the model reconstructing a payoff from the setup + its own
 * training data on a popular series.
 *
 * Fails CLOSED: any model/parse error is treated as a leak (safer to drop emphasis than to spoil).
 */

import { generateJson } from './llm';

const GUARD_SYSTEM =
  'You are a spoiler-safety guard. Decide whether a passage reveals or lets a reader infer any of ' +
  'the hidden future facts provided. Naming an entity that already appears is fine; revealing an ' +
  'OUTCOME (a death, identity, betrayal, or twist) from the hidden facts is a leak.';

const buildPrompt = (text: string, payoffs: string[]): string =>
  `PASSAGE (shown to the reader):\n${text}\n\n` +
  `HIDDEN FUTURE FACTS (the reader must NOT learn these yet):\n` +
  payoffs.map((p, i) => `${i + 1}. ${p}`).join('\n') +
  `\n\nReturn STRICT JSON: {"leaks": true|false, "reason": "short"}.`;

export interface GuardResult {
  leaks: boolean;
  reason?: string;
}

/**
 * Returns true if `text` leaks any of `payoffSummaries`. With no payoffs there is nothing to leak
 * (returns false). On any error, returns true (fail closed).
 */
export const checkPayoffLeak = async (
  text: string,
  payoffSummaries: string[],
): Promise<boolean> => {
  if (!text || payoffSummaries.length === 0) return false;
  try {
    const data = await generateJson(buildPrompt(text, payoffSummaries), {
      systemInstruction: GUARD_SYSTEM,
    });
    if (!data || typeof data.leaks !== 'boolean') return true;
    return data.leaks;
  } catch {
    return true;
  }
};
