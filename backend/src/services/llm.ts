import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

const genAI = new GoogleGenAI({ apiKey: env.geminiApiKey || '' });

export const getModel = () => {
  // The new SDK doesn't return a model object in the same way, 
  // but we can return a wrapper or just the client if we change usage.
  // However, to keep rag.ts compatible, let's see how rag.ts uses it.
  // rag.ts: const model = getModel(); const result = await model.generateContent(prompt);
  // In new SDK: ai.models.generateContent({ model: '...', contents: ... })

  // We need to adapt this.
  // Let's return an object that mimics the old interface or update rag.ts.
  // Updating rag.ts is cleaner.
  return {
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

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const response = await genAI.models.embedContent({
    model: 'text-embedding-004',
    contents: text
  });
  // Check if response.embeddings exists and has values
  if (!response.embeddings || !response.embeddings[0] || !response.embeddings[0].values) {
    throw new Error('Failed to generate embedding');
  }
  return response.embeddings[0].values;
};
