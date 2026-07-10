/**
 * LLM usage accounting (M6). `recordUsage` is fire-and-forget — it must never block or fail an LLM
 * call, so errors are swallowed (logged at debug). `getUsageSummary` aggregates raw token counts and
 * applies pricing at read time.
 */

import { pool } from '../db/pool';
import { logger } from './logger';
import { costFor, isPriced } from './pricing';

export interface UsageRecord {
  context: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  storyId?: string;
}

/** Insert a usage row without awaiting it in the hot path (best-effort accounting). */
export const recordUsage = (u: UsageRecord): void => {
  pool
    .query(
      `INSERT INTO llm_usage (context, model, input_tokens, output_tokens, story_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [u.context, u.model, u.inputTokens || 0, u.outputTokens || 0, u.storyId ?? null],
    )
    .catch((err) => logger.debug({ err }, 'recordUsage failed (non-fatal)'));
};

export interface UsageRow {
  model: string;
  context: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: boolean;
}

export interface UsageSummary {
  rows: UsageRow[];
  totalCostUsd: number;
  totalCalls: number;
}

/** Aggregate usage by (model, context), pricing each group at read time. */
export const getUsageSummary = async (): Promise<UsageSummary> => {
  const { rows } = await pool.query<{
    model: string; context: string; calls: string;
    input_tokens: string; output_tokens: string;
  }>(
    `SELECT model, context, COUNT(*) AS calls,
            SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
     FROM llm_usage GROUP BY model, context ORDER BY model, context`,
  );

  const summary: UsageRow[] = rows.map((r) => {
    const inputTokens = Number(r.input_tokens);
    const outputTokens = Number(r.output_tokens);
    const costUsd = costFor(r.model, inputTokens, outputTokens);
    return {
      model: r.model,
      context: r.context,
      calls: Number(r.calls),
      inputTokens,
      outputTokens,
      costUsd: Number(costUsd.toFixed(6)),
      priced: isPriced(r.model),
    };
  });

  return {
    rows: summary,
    totalCostUsd: Number(summary.reduce((s, r) => s + r.costUsd, 0).toFixed(6)),
    totalCalls: summary.reduce((s, r) => s + r.calls, 0),
  };
};
