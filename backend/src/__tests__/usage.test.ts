/**
 * Usage/cost tests (M6): read-time pricing math + the aggregated /api/admin/usage report.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() }, checkDatabase: vi.fn(), closePool: vi.fn() }));

import { pool } from '../db/pool';
import { costFor, isPriced } from '../services/pricing';
import { getUsageSummary } from '../services/usage';
import { createApp } from '../app';

const mockQuery = vi.mocked(pool.query);

describe('pricing', () => {
  it('prices flash-lite input+output per 1M tokens', () => {
    // 1M input @ $0.10 + 1M output @ $0.40 = $0.50
    expect(costFor('gemini-flash-lite-latest', 1_000_000, 1_000_000)).toBeCloseTo(0.5, 6);
  });

  it('prices embeddings on input only', () => {
    expect(costFor('gemini-embedding-2', 1_000_000, 0)).toBeCloseTo(0.2, 6);
  });

  it('returns 0 and flags unmodeled models', () => {
    expect(costFor('some-future-model', 1_000_000, 0)).toBe(0);
    expect(isPriced('some-future-model')).toBe(false);
    expect(isPriced('gemini-embedding-2')).toBe(true);
  });
});

describe('getUsageSummary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aggregates rows and totals cost at read time', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { model: 'gemini-flash-lite-latest', context: 'chat:recall', calls: '2', input_tokens: '1000000', output_tokens: '1000000' },
        { model: 'gemini-embedding-2', context: 'embedding-query', calls: '5', input_tokens: '1000000', output_tokens: '0' },
      ],
    } as never);
    const summary = await getUsageSummary();
    expect(summary.totalCalls).toBe(7);
    expect(summary.totalCostUsd).toBeCloseTo(0.7, 6); // 0.5 + 0.2
    expect(summary.rows[0]).toMatchObject({ model: 'gemini-flash-lite-latest', priced: true });
  });
});

describe('GET /api/admin/usage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the usage report', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await request(createApp()).get('/api/admin/usage');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rows: [], totalCostUsd: 0, totalCalls: 0 });
  });
});
