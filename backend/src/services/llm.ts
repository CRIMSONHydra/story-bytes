/**
 * LLM service for interacting with Google's Gemini AI models.
 * Handles text generation and embedding generation using the @google/genai SDK.
 */

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { MAIN_MODEL, LITE_MODEL, EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS } from '../config/models';

// Lazily initialize the Google GenAI client. Deferring construction until first use avoids the
// SDK's "API key should be set" warning firing at import time in environments where Gemini is never
// called (e.g. unit tests, which mock all model calls) or not configured (reading-only mode).
let genAIClient: GoogleGenAI | null = null;
const genAIModels = () => {
  if (!genAIClient) {
    genAIClient = new GoogleGenAI({ apiKey: env.geminiApiKey || '' });
  }
  return genAIClient.models;
};

/**
 * Gets a model wrapper that provides a compatible interface for text generation.
 * 
 * @returns Model object with generateContent method
 * 
 * @remarks
 * This wrapper adapts the new @google/genai SDK interface to maintain
 * compatibility with existing code that expects the old interface.
 */
export const getModel = () => {
  return {
    /**
     * Generates text content using Gemini 2.5 Flash model.
     * @param prompt - The text prompt to send to the model
     * @returns Promise resolving to response object with text() method
     */
    generateContent: async (prompt: string, options?: { temperature?: number }) => {
      const response = await genAIModels().generateContent({
        model: MAIN_MODEL,
        contents: prompt,
        config: options?.temperature !== undefined ? { temperature: options.temperature } : undefined,
      });
      return {
        response: {
          text: () => response.text || ''
        }
      };
    }
  };
};

/**
 * Generates a JSON object from a prompt using a chosen Gemini model with true system-role
 * separation and enforced JSON output. Returns the parsed object, or null if the model output
 * cannot be parsed as JSON (callers decide how to handle — e.g. the answer-guard fails closed).
 *
 * @param prompt - the user prompt
 * @param options.model - model id (default LITE_MODEL: cheap, fast, for guard/rewrite/judge)
 * @param options.systemInstruction - system-role instruction (prompt-injection separation)
 */
export const generateJson = async (
  prompt: string,
  options?: { model?: string; systemInstruction?: string },
): Promise<Record<string, unknown> | null> => {
  const response = await genAIModels().generateContent({
    model: options?.model ?? LITE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      ...(options?.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    },
  });
  return parseJsonResponse(response.text || '');
};

/**
 * Parses a model text response as JSON, tolerating ```json fences. Returns null on failure.
 */
const parseJsonResponse = (text: string): Record<string, unknown> | null => {
  let t = text.trim();
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n');
    t = nl >= 0 ? t.slice(nl + 1) : t.slice(3);
    if (t.endsWith('```')) t = t.slice(0, -3);
  }
  try {
    return JSON.parse(t.trim());
  } catch {
    return null;
  }
};

/**
 * Generates an embedding vector for the given text using Google's gemini-embedding-001 model.
 *
 * @param text - The text to generate an embedding for
 * @returns Promise resolving to an array of numbers representing the embedding vector
 * @throws Error if embedding generation fails or response is invalid
 */
export const EMBEDDING_MODEL = EMBEDDING_MODEL_ID;

/**
 * The embedding "model tag" retrieval matches on (block_embeddings.model). Vectors from a given
 * model+dimensionality live under one tag; retrieval matches it. Bumping the model/dims changes the
 * tag so old and new vectors never mix (they have different dimensions anyway).
 */
export const EMBEDDING_MODEL_TAG = process.env.EMBEDDING_MODEL_TAG || `${EMBEDDING_MODEL_ID}/${EMBEDDING_DIMENSIONS}`;

export type EmbeddingKind = 'query' | 'document';

/**
 * gemini-embedding-2 has no task_type parameter — task instructions are prepended to the input.
 * Queries and documents must use the matching instruction format to share an embedding space.
 */
export const buildEmbeddingInput = (text: string, kind: EmbeddingKind): string =>
  kind === 'query' ? `task: search result | query: ${text}` : `text: ${text}`;

/**
 * Generate an embedding with gemini-embedding-2 at EMBEDDING_DIMENSIONS (MRL, auto-normalized).
 * Pass kind='query' for search queries and kind='document' (default) for stored content so the
 * in-prompt task instructions line up.
 */
export const generateEmbedding = async (
  text: string,
  kind: EmbeddingKind = 'document',
): Promise<number[]> => {
  const response = await genAIModels().embedContent({
    model: EMBEDDING_MODEL_ID,
    contents: buildEmbeddingInput(text, kind),
    config: { outputDimensionality: EMBEDDING_DIMENSIONS },
  });

  // Validate response structure
  if (!response.embeddings || !response.embeddings[0] || !response.embeddings[0].values) {
    throw new Error('Failed to generate embedding: invalid response structure');
  }

  return response.embeddings[0].values;
};
