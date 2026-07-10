/**
 * Token → dollar pricing (M6). Applied at READ time so re-pricing never needs a data backfill.
 * Rates are USD per 1M tokens (see docs/IMPROVEMENT_PLAN.md §11). Unknown models price at 0 (and are
 * surfaced in the usage report) rather than guessing.
 */

interface Rate {
  input: number; // $/1M input tokens
  output: number; // $/1M output tokens
}

const RATES: Record<string, Rate> = {
  // Current tiers (demo runs both main + lite on flash-lite).
  'gemini-flash-latest': { input: 0.3, output: 2.5 },
  'gemini-flash-lite-latest': { input: 0.1, output: 0.4 },
  'gemini-embedding-2': { input: 0.2, output: 0 },
  // Retired ids kept so historical rows still price correctly.
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-embedding-001': { input: 0.15, output: 0 },
};

export const isPriced = (model: string): boolean => model in RATES;

/** Dollar cost for a call. Returns 0 for unmodeled models (use isPriced to flag those). */
export const costFor = (model: string, inputTokens: number, outputTokens: number): number => {
  const rate = RATES[model];
  if (!rate) return 0;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
};
