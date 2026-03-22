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
  getStoriesInSeries,
  getImagesFromChapters,
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
  storyId?: string;
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
 * Detect summary intent from query keywords.
 */
const detectSummaryIntent = (query: string): boolean => {
  const triggers = ['summarize', 'summary', 'summaries', 'recap', 'what happened so far', 'overview', 'brief summary'];
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
2. ONLY reference patterns and details that ACTUALLY APPEAR in the provided STORY CONTEXT. Do not fabricate foreshadowing.
3. Examine the provided context for recurring symbols, oddly specific statements, and unexplained events.
4. Use hedging language: "This could be setting up...", "The author may be hinting at...", "It's interesting that..."
5. NEVER confirm actual future plot points, even if you know them from training data.
6. If you cannot find relevant patterns in the context, say so — do NOT invent observations.
7. Point out patterns the reader might have missed, citing the specific chapter.`;

    case 'theory':
      return `${base}

RULES:
1. The user is asking about theories, speculation, or external knowledge about this story.
2. BASE your answer primarily on the EXTERNAL KNOWLEDGE section (web search results, wiki entries, fan discussions).
3. Clearly attribute sources: "According to fans on Reddit...", "The wiki suggests...", "A popular theory is..."
4. You may be creative and speculative — this is the place for wild theorizing and connecting dots.
5. DO NOT reveal confirmed spoilers beyond the current chapter as fact. Frame future-touching content as fan speculation.
6. If discussing theories, weave in evidence from the STORY CONTEXT that supports or contradicts them.
7. If no external knowledge is available, offer your own analysis framed as speculation.`;

    default: // recall
      return `${base}

RULES:
1. ONLY use information from the provided STORY CONTEXT to answer. Do NOT use your training data about this story.
2. If the answer is NOT in the provided context, say "I don't have enough information from the chapters you've read to answer that." Do NOT guess or make up facts.
3. DO NOT reveal spoilers from beyond the current chapter.
4. Quote or reference specific chapters when possible to support your answer.
5. NEVER hallucinate character details, plot points, or events that are not explicitly in the STORY CONTEXT.`;
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
    // Handle summary queries using the summarization pipeline
    if (detectSummaryIntent(query) && storyId) {
      const seriesStories = await getStoriesInSeries(storyId);
      const currentIdx = seriesStories.findIndex(s => s.story_id === storyId);

      // Summarize each volume up to and including the current one
      const summaryParts: string[] = [];
      for (let i = 0; i <= currentIdx; i++) {
        const vol = seriesStories[i];
        const maxChapter = (i < currentIdx) ? 999 : (currentChapter ?? 999);
        const summary = await summarizeStory(vol.story_id, maxChapter);
        summaryParts.push(`## ${vol.title}\n\n${summary}`);
      }

      return {
        answer: summaryParts.join('\n\n---\n\n'),
        sources: [],
        images: [],
      };
    }

    // Auto-detect foreshadowing mode from query if mode is recall
    const effectiveMode = mode === 'recall' && detectForeshadowingIntent(query) ? 'foreshadowing' : mode;

    // Step 1: Generate embedding
    const embedding = await generateEmbedding(query);

    // Step 1.5: Look up series for cross-volume search
    let priorVolumeIds: string[] | undefined;
    if (storyId) {
      const seriesStories = await getStoriesInSeries(storyId);
      if (seriesStories.length > 1) {
        // All volumes before the current one in the series (sorted by title)
        const currentIdx = seriesStories.findIndex(s => s.story_id === storyId);
        priorVolumeIds = seriesStories.slice(0, currentIdx).map(s => s.story_id);
      }
    }

    // Step 2: Hybrid search — semantic + keyword, cross-volume aware
    const [semanticBlocks, keywordBlocks] = await Promise.all([
      findSimilarBlocks(embedding, storyId, currentChapter, 5, priorVolumeIds),
      findBlocksByKeyword(query, storyId, currentChapter, 5, priorVolumeIds),
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

    // Step 3: Image retrieval — from asset embeddings + from matched chapters
    const matchedChapterOrders = [...new Set(mergedBlocks.map(b => b.chapter_order))];
    const [relevantImages, chapterImages] = await Promise.all([
      findRelevantImages(embedding, storyId, currentChapter),
      storyId ? getImagesFromChapters(matchedChapterOrders, storyId, currentChapter) : Promise.resolve([]),
    ]);

    let externalContext = '';

    // Step 4: External Knowledge (Smart Search)
    if (requiresExternalKnowledge(query, effectiveMode) && storyId) {
      const knownFacts = await findSimilarExternalKnowledge(embedding, storyId);

      if (knownFacts.length > 0) {
        externalContext += '\n\nExisting Knowledge:\n' + knownFacts.map(k => `- ${k.content}`).join('\n');
      }

      console.log('Triggering web search for:', query);
      const [wikiResults, redditResults] = await Promise.all([
        searchWeb(query + ' site:fandom.com OR site:wiki', 3),
        searchWeb(query + ' site:reddit.com discussion theory', 3),
      ]);
      const searchResults = [...wikiResults, ...redditResults];

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
      .map((block) => {
        const volumePrefix = block.story_title ? `${block.story_title}, ` : '';
        return `[${volumePrefix}Chapter ${block.chapter_order}: ${block.title}]\n${block.text_content}`;
      })
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
    const temperature = effectiveMode === 'theory' ? undefined : 0;
    const result = await model.generateContent(prompt, { temperature });
    const answer = result.response.text();

    // Build sources from blocks used
    const sources: ChatSource[] = mergedBlocks.map(b => ({
      chapterOrder: b.chapter_order,
      blockId: b.block_id,
      title: b.title,
    }));

    // Build image list — combine asset-embedded images + chapter illustrations
    const images: ChatImage[] = relevantImages.map(img => ({
      assetId: img.asset_id,
      href: img.href,
      description: img.visual_description || '',
    }));

    // Add chapter illustrations (served via story image endpoint, not asset endpoint)
    const seenHrefs = new Set(images.map(i => i.href));
    for (const chImg of chapterImages) {
      if (!seenHrefs.has(chImg.image_src)) {
        images.push({
          assetId: '',
          href: chImg.image_src,
          description: `Illustration from ${chImg.title}`,
          storyId: chImg.story_id,
        });
        seenHrefs.add(chImg.image_src);
      }
    }

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
      `Summarize this volume in 3-5 sentences. Cover only the main plot arc, central conflict, and outcome. ` +
      `No chapter-by-chapter breakdown. Do NOT include events beyond Chapter ${upToChapter}.\n\n${allText}`
    );
    summary = result.response.text();
  } else {
    // Recursive summarization: summarize in chunks, then summarize summaries
    const chunkSummaries: string[] = [];
    let chunk = '';

    for (const ch of chapters) {
      const entry = `## Chapter ${ch.chapter_order}: ${ch.title}\n${ch.aggregated_text || ''}\n\n`;
      if (chunk.length + entry.length > MAX_CHUNK_CHARS && chunk.length > 0) {
        const res = await model.generateContent(
          `Summarize these chapters in 2-3 sentences covering only the main events:\n\n${chunk}`
        );
        chunkSummaries.push(res.response.text());
        chunk = '';
      }
      chunk += entry;
    }
    if (chunk) {
      const res = await model.generateContent(
        `Summarize these chapters in 2-3 sentences covering only the main events:\n\n${chunk}`
      );
      chunkSummaries.push(res.response.text());
    }

    // Final summary of summaries
    const combined = chunkSummaries.map((s, i) => `Part ${i + 1}:\n${s}`).join('\n\n');
    const finalResult = await model.generateContent(
      `Combine into a single 3-5 sentence summary of this volume's main plot. ` +
      `No bullet points, no chapter references, just a flowing narrative:\n\n${combined}`
    );
    summary = finalResult.response.text();
  }

  // Cache the result
  await saveSummary(storyId, upToChapter, summary, modelName);

  return summary;
};
