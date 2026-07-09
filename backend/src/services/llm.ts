/**
 * LLM service for interacting with Google's Gemini AI models.
 * Handles text generation and embedding generation using the @google/genai SDK.
 */

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

// Initialize Google GenAI client with API key from environment
const genAI = new GoogleGenAI({ apiKey: env.geminiApiKey || '' });

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
      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
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
 * @param options.model - model id (default gemini-2.5-flash-lite: cheap, fast, for guard/rewrite/judge)
 * @param options.systemInstruction - system-role instruction (prompt-injection separation)
 */
export const generateJson = async (
  prompt: string,
  options?: { model?: string; systemInstruction?: string },
): Promise<Record<string, unknown> | null> => {
  const response = await genAI.models.generateContent({
    model: options?.model ?? 'gemini-2.5-flash-lite',
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
export const EMBEDDING_MODEL = 'gemini-embedding-001';

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const response = await genAI.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { outputDimensionality: 768 },
  });
  
  // Validate response structure
  if (!response.embeddings || !response.embeddings[0] || !response.embeddings[0].values) {
    throw new Error('Failed to generate embedding: invalid response structure');
  }
  
  return response.embeddings[0].values;
};
