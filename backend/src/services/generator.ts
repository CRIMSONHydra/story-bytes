/**
 * Image generator (M17) — the live Nano-Banana call, isolated so the orchestration (cache/cap/spoiler
 * gate in imageGen.ts) stays testable with this mocked. Uses @google/genai generateContent image
 * output; each attempt is bounded by a request timeout and retried once, so the worst case stays well
 * under the 120s nginx timeout. Token usage is threaded back for cost accounting.
 */

import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { env } from '../config/env';
import { IMAGE_GEN_MODEL } from '../config/models';
import { logger } from './logger';

let client: GoogleGenAI | null = null;
const genAI = () => (client ??= new GoogleGenAI({ apiKey: env.geminiApiKey || '' }));

const REQUEST_TIMEOUT_MS = 60_000;

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  inputTokens: number;
  outputTokens: number;
}

const extractInlineImage = (response: GenerateContentResponse): GeneratedImage | null => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        data: Buffer.from(part.inlineData.data, 'base64'),
        mimeType: part.inlineData.mimeType || 'image/png',
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }
  }
  return null;
};

/** Generate one image for `prompt`. Retries once on transient failure; throws if no image is produced. */
export const generateImage = async (prompt: string, attempts = 2): Promise<GeneratedImage> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await genAI().models.generateContent({
        model: IMAGE_GEN_MODEL,
        contents: prompt,
        config: { httpOptions: { timeout: REQUEST_TIMEOUT_MS } },
      });
      const image = extractInlineImage(response);
      if (image) return image;
      lastErr = new Error('model returned no image part');
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt: i + 1 }, 'Image generation attempt failed');
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('image generation failed');
};
