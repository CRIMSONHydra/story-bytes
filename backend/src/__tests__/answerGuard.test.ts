/**
 * Answer-guard payoff-leak tests (plan §2.14.4) — the runtime backstop for the foreshadowing path.
 * Verifies it defers to the model verdict when parseable, and FAILS CLOSED otherwise.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/llm', () => ({
  generateJson: vi.fn(),
}));

import * as llm from '../services/llm';
import { checkPayoffLeak } from '../services/answerGuard';

const mockGen = vi.mocked(llm.generateJson);

describe('answerGuard.checkPayoffLeak', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false (nothing to leak) when there are no payoff summaries', async () => {
    const leaked = await checkPayoffLeak('some answer', []);
    expect(leaked).toBe(false);
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('returns false for empty text', async () => {
    expect(await checkPayoffLeak('', ['a payoff'])).toBe(false);
  });

  it('reports a leak when the model says so', async () => {
    mockGen.mockResolvedValueOnce({ leaks: true, reason: 'reveals the death' });
    expect(await checkPayoffLeak('X dies at the end', ['X dies'])).toBe(true);
  });

  it('reports safe when the model says no leak', async () => {
    mockGen.mockResolvedValueOnce({ leaks: false });
    expect(await checkPayoffLeak('An odd detail worth noting.', ['X is the villain'])).toBe(false);
  });

  it('fails CLOSED (treats as leak) when the model output is unparseable', async () => {
    mockGen.mockResolvedValueOnce(null);
    expect(await checkPayoffLeak('anything', ['secret'])).toBe(true);
  });

  it('fails CLOSED when the model output lacks a boolean leaks field', async () => {
    mockGen.mockResolvedValueOnce({ verdict: 'maybe' } as never);
    expect(await checkPayoffLeak('anything', ['secret'])).toBe(true);
  });

  it('fails CLOSED when the model call throws', async () => {
    mockGen.mockRejectedValueOnce(new Error('network'));
    expect(await checkPayoffLeak('anything', ['secret'])).toBe(true);
  });
});
