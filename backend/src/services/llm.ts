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
    generateContent: async (prompt: string) => {
      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
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
 * Generates an embedding vector for the given text using Google's text-embedding-004 model.
 * 
 * @param text - The text to generate an embedding for
 * @returns Promise resolving to an array of numbers representing the embedding vector
 * @throws Error if embedding generation fails or response is invalid
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  const response = await genAI.models.embedContent({
    model: 'text-embedding-004',
    contents: text
  });
  
  // Validate response structure
  if (!response.embeddings || !response.embeddings[0] || !response.embeddings[0].values) {
    throw new Error('Failed to generate embedding: invalid response structure');
  }
  
  return response.embeddings[0].values;
};
