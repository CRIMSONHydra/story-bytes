/**
 * RAG (Retrieval-Augmented Generation) service.
 * Combines semantic search with LLM generation to answer questions about stories.
 * Supports multiple chat modes: recall, foreshadowing, and theory.
 */

import { getModel, generateEmbedding } from './llm';
import {
  findSimilarBlocks,
  findSimilarExternalKnowledge,
  insertExternalKnowledge,
  findRelevantImages,
  findBlocksByKeyword,
  getChapterTexts,
  getCachedSummary,
  saveSummary,
} from './db';
import { searchWeb } from './search';

export type ChatMode = 'recall' | 'foreshadowing' | 'theory';

export interface ChatSource {
  chapterOrder: number;
  blockId: string;
  title: string;
}

export interface ChatImage {
  assetId: string;
  href: string;
  description: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  images: ChatImage[];
}

/**
 * Analyzes the query to determine if it requires external knowledge.
 */
const requiresExternalKnowledge = (query: string, mode: ChatMode): boolean => {
  if (mode === 'theory') return true;
  const triggers = ['theory', 'theories', 'speculate', 'online', 'reddit', 'wiki', 'author', 'interview', 'confirmed'];
  return triggers.some(t => query.toLowerCase().includes(t));
};

/**
 * Detect foreshadowing intent from query keywords.
 */
const detectForeshadowingIntent = (query: string): boolean => {
  const triggers = ['hint', 'foreshadow', 'what could', 'what does', 'mean', 'symbolize', 'symbol', 'ominous', 'predict', 'setup'];
  return triggers.some(t => query.toLowerCase().includes(t));
};

/**
 * Build mode-specific system prompts.
 */
const buildSystemPrompt = (mode: ChatMode, currentChapter: number | undefined): string => {
  const base = `You are an intelligent assistant for a story reading app called "Story Bytes".
The user is reading a story and is currently at Chapter ${currentChapter ?? 'Unknown'}.`;

  switch (mode) {
    case 'foreshadowing':
      return `${base}

RULES:
1. The user is looking for foreshadowing, hints, and setup in what they've read so far.
2. Examine the provided context for recurring symbols, oddly specific statements, and unexplained events.
3. Use hedging language: "This could be setting up...", "The author may be hinting at...", "It's interesting that..."
4. NEVER confirm actual future plot points, even if you know them from training data.
5. Focus on textual evidence from the provided context to support your analysis.
6. Point out patterns the reader might have missed.`;

    case 'theory':
      return `${base}

RULES:
1. The user is asking about theories, speculation, or external knowledge about this story.
2. BASE your answer primarily on the EXTERNAL KNOWLEDGE section.
3. Clearly label sources: "According to online theories...", "Sources suggest...", "Fans have speculated..."
4. DO NOT reveal confirmed spoilers beyond the current chapter.
5. If discussing theories that touch on future events, frame them as speculation, not fact.
6. If the answer is not available, say so honestly.`;

    default: // recall
      return `${base}

RULES:
1. BASE your answer on the provided STORY CONTEXT.
2. DO NOT reveal spoilers from beyond the current chapter.
3. If the user asks for theories/outside info, use the EXTERNAL KNOWLEDGE section.
4. IF using External Knowledge, explicitly state "According to online theories..." or "Sources suggest...".
5. If the answer is not in the context, say "I don't have enough information from what you've read so far."`;
  }
};

/**
 * Answers a user's question about a story using RAG with hybrid search
 * and image-aware responses.
 */
export const answerQuery = async (
  query: string,
  storyId?: string,
  currentChapter?: number,
  mode: ChatMode = 'recall'
): Promise<ChatResponse> => {
  try {
    // Auto-detect foreshadowing mode from query if mode is recall
    const effectiveMode = mode === 'recall' && detectForeshadowingIntent(query) ? 'foreshadowing' : mode;

    // Step 1: Generate embedding
    const embedding = await generateEmbedding(query);

    // Step 2: Hybrid search — semantic + keyword (Phase 4)
    const [semanticBlocks, keywordBlocks] = await Promise.all([
      findSimilarBlocks(embedding, storyId, currentChapter),
      findBlocksByKeyword(query, storyId, currentChapter),
    ]);

    // Merge and deduplicate, preferring semantic scores
    const blockMap = new Map<string, typeof semanticBlocks[0]>();
    for (const block of semanticBlocks) {
      blockMap.set(block.block_id, block);
    }
    for (const block of keywordBlocks) {
      if (!blockMap.has(block.block_id)) {
        // Apply hybrid weighting: keyword results get a scaled similarity
        blockMap.set(block.block_id, { ...block, similarity: block.similarity * 0.3 });
      }
    }
    const mergedBlocks = [...blockMap.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8);

    // Step 3: Image retrieval (Phase 3 Pass 3)
    const relevantImages = await findRelevantImages(embedding, storyId, currentChapter);

    let externalContext = '';

    // Step 4: External Knowledge (Smart Search)
    if (requiresExternalKnowledge(query, effectiveMode) && storyId) {
      const knownFacts = await findSimilarExternalKnowledge(embedding, storyId);

      if (knownFacts.length > 0) {
        externalContext += '\n\nExisting Knowledge:\n' + knownFacts.map(k => `- ${k.content}`).join('\n');
      }

      console.log('Triggering web search for:', query);
      const searchResults = await searchWeb(query + ' story discussion theories');

      if (searchResults.length > 0) {
        const searchSummary = searchResults.slice(0, 3).map(r => `${r.title}: ${r.snippet}`).join('\n');
        externalContext += `\n\nWeb Search Results:\n${searchSummary}`;

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

    // Step 5: Format Context
    const storyContext = mergedBlocks
      .map((block) => `[Chapter ${block.chapter_order}: ${block.title}]\n${block.text_content}`)
      .join('\n\n');

    const imageContext = relevantImages.length > 0
      ? '\n\nRELEVANT IMAGES:\n' + relevantImages.map(img => {
        const meta = img.enriched_metadata as Record<string, unknown> | null;
        const chars = meta?.characters ? ` (Characters: ${(meta.characters as string[]).join(', ')})` : '';
        return `- ${img.visual_description || img.href}${chars}`;
      }).join('\n')
      : '';

    // Step 6: Generate Answer
    const systemPrompt = buildSystemPrompt(effectiveMode, currentChapter);
    const prompt = `${systemPrompt}

STORY CONTEXT (Read so far):
${storyContext || '(no matching content found)'}

EXTERNAL KNOWLEDGE (Theories/Facts):
${externalContext || 'None'}
${imageContext}

User Question: ${query}

Answer:`;

    const model = getModel();
    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    // Build sources from blocks used
    const sources: ChatSource[] = mergedBlocks.map(b => ({
      chapterOrder: b.chapter_order,
      blockId: b.block_id,
      title: b.title,
    }));

    // Build image list
    const images: ChatImage[] = relevantImages.map(img => ({
      assetId: img.asset_id,
      href: img.href,
      description: img.visual_description || '',
    }));

    return { answer, sources, images };
  } catch (error) {
    console.error('Error in RAG answerQuery:', error);
    return {
      answer: "I'm sorry, I encountered an error while trying to answer your question.",
      sources: [],
      images: [],
    };
  }
};

/**
 * Phase 4: Generate a spoiler-safe summary up to a given chapter.
 * Uses recursive summarization for long stories and caches results.
 */
export const summarizeStory = async (
  storyId: string,
  upToChapter: number
): Promise<string> => {
  const modelName = 'gemini-2.5-flash';

  // Check cache first
  const cached = await getCachedSummary(storyId, upToChapter, modelName);
  if (cached) return cached;

  const chapters = await getChapterTexts(storyId, upToChapter);
  if (chapters.length === 0) return 'No chapters found for this story.';

  const model = getModel();

  // For short stories (< 5 chapters), summarize in one pass
  const allText = chapters
    .map(c => `## Chapter ${c.chapter_order}: ${c.title}\n${c.aggregated_text || '(no text)'}`)
    .join('\n\n');

  const MAX_CHUNK_CHARS = 30000;

  let summary: string;

  if (allText.length <= MAX_CHUNK_CHARS) {
    const result = await model.generateContent(
      `Summarize the following story content up to Chapter ${upToChapter}. ` +
      `Be thorough but concise. Include key plot points, character developments, and important events. ` +
      `Do NOT include any events beyond Chapter ${upToChapter}.\n\n${allText}`
    );
    summary = result.response.text();
  } else {
    // Recursive summarization: summarize in chunks, then summarize summaries
    const chunkSummaries: string[] = [];
    let chunk = '';
    let chunkStart = 0;

    for (const ch of chapters) {
      const entry = `## Chapter ${ch.chapter_order}: ${ch.title}\n${ch.aggregated_text || ''}\n\n`;
      if (chunk.length + entry.length > MAX_CHUNK_CHARS && chunk.length > 0) {
        const res = await model.generateContent(
          `Summarize chapters ${chunkStart} through ${ch.chapter_order - 1} of this story:\n\n${chunk}`
        );
        chunkSummaries.push(res.response.text());
        chunk = '';
        chunkStart = ch.chapter_order;
      }
      chunk += entry;
    }
    if (chunk) {
      const res = await model.generateContent(
        `Summarize chapters ${chunkStart} through ${upToChapter} of this story:\n\n${chunk}`
      );
      chunkSummaries.push(res.response.text());
    }

    // Final summary of summaries
    const combined = chunkSummaries.map((s, i) => `Part ${i + 1}:\n${s}`).join('\n\n');
    const finalResult = await model.generateContent(
      `Combine these partial summaries into one cohesive summary of the story up to Chapter ${upToChapter}. ` +
      `Maintain chronological order and highlight the most important events:\n\n${combined}`
    );
    summary = finalResult.response.text();
  }

  // Cache the result
  await saveSummary(storyId, upToChapter, summary, modelName);

  return summary;
};
