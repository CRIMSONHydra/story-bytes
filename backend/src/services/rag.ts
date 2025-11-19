/**
 * RAG (Retrieval-Augmented Generation) service.
 * Combines semantic search with LLM generation to answer questions about stories.
 */

import { getModel, generateEmbedding } from './llm';
import { findSimilarBlocks, findSimilarExternalKnowledge, insertExternalKnowledge } from './db';
import { searchWeb } from './search';

/**
 * Analyzes the query to determine if it requires external knowledge.
 * Returns true if the query implies theories, speculation, or facts not in the text.
 */
const requiresExternalKnowledge = (query: string): boolean => {
  const triggers = ['theory', 'theories', 'speculate', 'online', 'reddit', 'wiki', 'author', 'interview', 'confirmed'];
  return triggers.some(t => query.toLowerCase().includes(t));
};

/**
 * Answers a user's question about a story using RAG.
 * 
 * Process:
 * 1. Generates an embedding vector for the query
 * 2. Finds similar text blocks from the story (Spoiler Guard)
 * 3. If query implies theories/external info:
 *    a. Searches existing external knowledge in DB
 *    b. If insufficient, performs live Google Search
 *    c. Summarizes and saves new findings to DB
 * 4. Constructs a prompt with Story Context + External Knowledge
 * 5. Generates an answer using Gemini LLM
 */
export const answerQuery = async (
  query: string,
  storyId?: string,
  currentChapter?: number
): Promise<string> => {
  try {
    // Step 1: Generate embedding
    const embedding = await generateEmbedding(query);

    // Step 2: Story Context (Spoiler Guard)
    const similarBlocks = await findSimilarBlocks(embedding, storyId, currentChapter);

    let externalContext = '';

    // Step 3: External Knowledge (Smart Search)
    if (requiresExternalKnowledge(query) && storyId) {
      // 3a. Search existing DB knowledge
      const knownFacts = await findSimilarExternalKnowledge(embedding, storyId);

      if (knownFacts.length > 0) {
        externalContext += '\n\nExisting Knowledge:\n' + knownFacts.map(k => `- ${k.content}`).join('\n');
      }

      // 3b. Live Web Search (if we need more info or just to be safe for "theory" questions)
      // For this prototype, we'll always search if it's a "theory" question to demonstrate the feature.
      //TODO: smart web search implementation
      console.log('Triggering web search for:', query);
      const searchResults = await searchWeb(query + ' story discussion theories');

      if (searchResults.length > 0) {
        const searchSummary = searchResults.slice(0, 3).map(r => `${r.title}: ${r.snippet}`).join('\n');
        externalContext += `\n\nWeb Search Results:\n${searchSummary}`;

        // 3c. Persist valuable findings (Async - don't block response)
        //TODO:
        // In a real app, we'd use an LLM to extract specific facts. Here we just save the top result as a "theory" note.
        const topResult = searchResults[0];
        void insertExternalKnowledge(
          storyId,
          `Search Result for "${query}": ${topResult.title} - ${topResult.snippet}`,
          topResult.link,
          'theory',
          embedding
        ).catch(err => console.error('Failed to save external knowledge:', err));
      }
    }

    // Step 4: Format Context
    const storyContext = similarBlocks
      .map((block) => `[Chapter ${block.chapter_order}: ${block.title}]\n${block.text_content}`)
      .join('\n\n');

    const fullContext = `
      STORY CONTEXT (Read so far):
      ${storyContext}

      EXTERNAL KNOWLEDGE (Theories/Facts):
      ${externalContext || 'None'}
    `;

    // Step 5: Generate Answer
    const prompt = `
      You are an intelligent assistant for a story reading app called "Story Bytes".
      The user is reading a story and is currently at Chapter ${currentChapter ?? 'Unknown'}.
      
      RULES:
      1. BASE your answer on the provided STORY CONTEXT.
      2. IF the user asks for theories/spoilers/outside info, use the EXTERNAL KNOWLEDGE section.
      3. DO NOT reveal spoilers from the story context that are BEYOND the current chapter (though the context provided should already be filtered).
      4. IF using External Knowledge, explicitly state "According to online theories..." or "Sources suggest...".
      5. If the answer is not in the context, say "I don't have enough information."

      Context:
      ${fullContext}

      User Question: ${query}

      Answer:
    `;

    const model = getModel();
    const result = await model.generateContent(prompt);
    return result.response.text();

  } catch (error) {
    console.error('Error in RAG answerQuery:', error);
    return "I'm sorry, I encountered an error while trying to answer your question.";
  }
};
