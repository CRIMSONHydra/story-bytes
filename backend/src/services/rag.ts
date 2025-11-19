import { getModel, generateEmbedding } from './llm';
import { findSimilarBlocks } from './db';

export const answerQuery = async (
  query: string,
  storyId?: string,
  currentChapter?: number
): Promise<string> => {
  try {
    // 1. Generate embedding for the query
    const embedding = await generateEmbedding(query);

    // 2. Find relevant context from the story, respecting spoiler constraints
    const similarBlocks = await findSimilarBlocks(embedding, storyId, currentChapter);

    // 3. Construct the prompt
    const contextText = similarBlocks
      .map((block) => `[Chapter ${block.chapter_order}: ${block.title}]\n${block.text_content}`)
      .join('\n\n');

    const prompt = `
      You are an intelligent assistant for a story reading app called "Story Bytes".
      Your goal is to answer the user's question based ONLY on the provided context.
      The user is currently reading the story and is at Chapter ${currentChapter ?? 'Unknown'}.
      DO NOT reveal any information that happens after the provided context (spoilers).
      If the answer is not in the context, say "I don't have enough information to answer that based on what you've read so far."

      Context:
      ${contextText}

      User Question: ${query}

      Answer:
    `;

    // 4. Generate answer using Gemini
    const model = getModel();
    const result = await model.generateContent(prompt);
    const response = result.response;

    return response.text();
  } catch (error) {
    console.error('Error in RAG answerQuery:', error);
    return "I'm sorry, I encountered an error while trying to answer your question.";
  }
};
