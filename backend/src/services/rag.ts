/**
 * RAG (Retrieval-Augmented Generation) service.
 * Combines semantic search with LLM generation to answer questions about stories.
 * Supports multiple chat modes: recall, foreshadowing, and theory.
 */

import { getModel, generateEmbedding } from './llm';
import {
  findSimilarBlocks,
  findSimilarExternalKnowledge,
  findRelevantImages,
  findBlocksByKeyword,
  getChapterTexts,
  getCachedSummary,
  saveSummary,
  getStoriesInSeries,
  getImagesFromChapters,
} from './db';
import {
  getForeshadowLinks, getLivePayoffSummaries, linkEntities, getEgoNetwork, getOpenThreads,
  type GraphEntity, type NamedEdge,
} from './graph';
import { checkPayoffLeak } from './answerGuard';
import { resolveSpoilerScope, DEFAULT_USER_ID } from './spoilerScope';

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
4. Point out a detail and say it is worth keeping in mind — but do NOT say what it "leads to", "sets up", "results in", or "means later". Flag the detail; never resolve it.
5. NEVER confirm, state, or speculatively infer any future plot point — treat this story as an unpublished manuscript you have never seen. Use ONLY the STORY CONTEXT; ignore any knowledge of this story from your training data.
6. NEVER mention, name, or quote a chapter, chapter title, event, or character the reader has not reached (only chapters up to Chapter ${currentChapter ?? 'the current one'} exist for this purpose). Do NOT reference a "Table of Contents" or list upcoming chapters.
7. Prefer the FORESHADOWING SEEDS section (if present): those setups + hints are pre-vetted safe. Present them; do not extrapolate past them.
8. If you cannot find relevant patterns in the context, say so — do NOT invent observations.`;

    case 'theory':
      return `${base}

RULES:
1. The user is asking about theories, speculation, or external knowledge about this story.
2. Treat this story as an unpublished manuscript you have never seen. Use ONLY the STORY CONTEXT (chapters the reader has read) and the EXTERNAL KNOWLEDGE section below. Do NOT use, cite, or paraphrase any knowledge of this story from your training data.
3. Base theories on the EXTERNAL KNOWLEDGE section and attribute ONLY sources that actually appear there. NEVER invent, name, or attribute a source (wiki, Reddit, fan forum) that is not present in EXTERNAL KNOWLEDGE. Fabricated citations are a serious error.
4. If the EXTERNAL KNOWLEDGE section is empty or "None": say plainly that there are no fan theories or external sources for this story yet. You may then offer speculation grounded ONLY in evidence from the STORY CONTEXT — do NOT introduce characters, identities, roles, events, or outcomes that do not appear in that context.
5. NEVER state or confirm a future plot point, a character's true identity or ultimate role, or an outcome — even framed as "a theory" or "fans speculate" — unless it is explicitly present in the EXTERNAL KNOWLEDGE section. If it is not in the provided material, you do not know it.
6. Do NOT mention, name, or quote a chapter, chapter title, event, or character the reader has not reached.
7. When you do speculate, weave in supporting or contradicting evidence from the STORY CONTEXT and keep it clearly hedged.`;

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
 * Format linked entities + their ego-network into a compact, spoiler-safe KNOWLEDGE GRAPH block.
 * Everything here is already chapter-gated by the graph queries (facts known as of the boundary).
 */
const formatGraphContext = (entities: GraphEntity[], edges: NamedEdge[]): string => {
  if (entities.length === 0) return '';
  const lines = entities.map((e) => {
    const aka = e.aliases.length > 0 ? ` (aka ${e.aliases.join(', ')})` : '';
    const state = e.latestState ? ` — ${e.latestState}` : '';
    const rels = edges
      .filter((r) => r.sourceName === e.name || r.targetName === e.name)
      .slice(0, 6)
      .map((r) => {
        const other = r.sourceName === e.name ? r.targetName : r.sourceName;
        const dir = r.sourceName === e.name ? `${r.relType} -> ${other}` : `${other} ${r.relType} ->`;
        const until = r.untilChapter !== null ? ` (Ch. ${r.sinceChapter}–${r.untilChapter})` : ` (since Ch. ${r.sinceChapter})`;
        return `    - ${dir}${until}${r.description ? `: ${r.description}` : ''}`;
      });
    return `- ${e.name} [${e.entityType}]${aka}${state}\n${rels.join('\n')}`.trimEnd();
  });
  return `\n\nKNOWLEDGE GRAPH (facts known as of the reader's current chapter):\n${lines.join('\n')}`;
};

/**
 * Answers a user's question about a story using RAG with hybrid search
 * and image-aware responses.
 */
export const answerQuery = async (
  query: string,
  storyId?: string,
  currentChapter?: number,
  mode: ChatMode = 'recall',
  userId: string = DEFAULT_USER_ID
): Promise<ChatResponse> => {
  try {
    // Resolve the spoiler boundary server-side when a story is scoped (default-deny: an omitted
    // currentChapter falls back to reading_progress, then 0 — never "everything"). priorVolumeIds
    // come from resolveSpoilerScope, ordered by volume_number (not the old lexicographic title sort).
    const scope = storyId ? await resolveSpoilerScope(storyId, currentChapter, userId) : null;
    const boundary = scope ? scope.maxChapterOrder : currentChapter;
    const priorVolumeIds = scope && scope.priorVolumeIds.length > 0 ? scope.priorVolumeIds : undefined;

    // Handle summary queries using the summarization pipeline
    if (detectSummaryIntent(query) && storyId) {
      const seriesStories = await getStoriesInSeries(storyId);
      const currentIdx = seriesStories.findIndex(s => s.story_id === storyId);

      // Summarize each volume up to and including the current one; prior volumes are fully read,
      // the current one is capped at the resolved boundary.
      const summaryParts: string[] = [];
      for (let i = 0; i <= currentIdx; i++) {
        const vol = seriesStories[i];
        const maxChapter = (i < currentIdx) ? 999 : (boundary ?? 0);
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

    // Step 1.7: GraphRAG — link the query to known entities (spoiler-visible aliases only), expand
    // the keyword arm with those aliases ("Dead End" also retrieves "Ruijerd" passages), and build a
    // KNOWLEDGE GRAPH context block. No-op when the story has no graph. Non-fatal.
    let graphContext = '';
    let keywordQuery = query;
    if (storyId) {
      try {
        const linked = await linkEntities(query, storyId, boundary ?? 0);
        if (linked.length > 0) {
          const aliasTerms = [...new Set(linked.flatMap((e) => [e.name, ...e.aliases]))];
          keywordQuery = `${query} ${aliasTerms.join(' ')}`;
          const ego = await getEgoNetwork(linked.map((e) => e.entityId), storyId, boundary ?? 0);
          graphContext = formatGraphContext(linked, ego);
        }
      } catch (err) {
        console.error('Graph linking failed (non-fatal):', err);
      }
    }

    // Step 2: Hybrid search — semantic + keyword, cross-volume aware (resolved boundary + prior volumes)
    const [semanticBlocks, keywordBlocks] = await Promise.all([
      findSimilarBlocks(embedding, storyId, boundary, 5, priorVolumeIds),
      findBlocksByKeyword(keywordQuery, storyId, boundary, 5, priorVolumeIds),
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
      findRelevantImages(embedding, storyId, boundary),
      storyId ? getImagesFromChapters(matchedChapterOrders, storyId, boundary) : Promise.resolve([]),
    ]);

    let externalContext = '';

    // Step 4: External knowledge — classified sources only.
    // Improvement Plan §3.6 (interim safety): live web-search (Google CSE) snippets are NO LONGER
    // injected into the prompt, and the old "store the raw search result as knowledge" write path is
    // removed. Raw, unclassified web results are the top spoiler-leak vector — for a popular series a
    // search for "who is X" returns "X is the main antagonist" straight into the answer. Until the
    // Theories pillar (M18) adds spoiler-classification of external content, theory mode uses only
    // already-classified external_knowledge rows plus the reader's own (chapter-bounded) story context.
    if (requiresExternalKnowledge(query, effectiveMode) && storyId) {
      const knownFacts = await findSimilarExternalKnowledge(embedding, storyId);
      if (knownFacts.length > 0) {
        externalContext += '\n\nExisting Knowledge:\n' + knownFacts.map(k => `- ${k.content}`).join('\n');
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
        const chars = Array.isArray(meta?.characters) ? ` (Characters: ${(meta.characters as string[]).join(', ')})` : '';
        return `- ${img.visual_description || img.href}${chars}`;
      }).join('\n')
      : '';

    // Foreshadowing seeds (plan §2.14): in foreshadowing mode, ground the answer in pre-identified
    // setups whose payoff is still ahead of the reader. Only setup + pre-vetted hint enter the prompt
    // — the payoff was never selected — so this is spoiler-safe by construction.
    let foreshadowContext = '';
    if (effectiveMode === 'foreshadowing' && storyId) {
      try {
        const seeds = await getForeshadowLinks(storyId, boundary ?? 0);
        if (seeds.length > 0) {
          foreshadowContext = '\n\nFORESHADOWING SEEDS (details already read that are worth keeping in mind — '
            + 'do NOT speculate about their future payoff as fact):\n'
            + seeds.map(s => `- [Ch. ${s.setupChapter}] ${s.setupSummary} — ${s.hint}`).join('\n');
        }
        // OPEN PLOT THREADS: unresolved threads as of the boundary, to ground foreshadowing.
        const threads = await getOpenThreads(storyId, boundary ?? 0);
        if (threads.length > 0) {
          foreshadowContext += '\n\nOPEN PLOT THREADS (unresolved as of the current chapter):\n'
            + threads.map(t => `- ${t.name}: ${t.latestBeat}`).join('\n');
        }
      } catch (err) {
        console.error('Foreshadowing seed lookup failed (non-fatal):', err);
      }
    }

    // Step 6: Generate Answer
    const systemPrompt = buildSystemPrompt(effectiveMode, boundary);
    const prompt = `${systemPrompt}

STORY CONTEXT (Read so far):
${storyContext || '(no matching content found)'}
${graphContext}

EXTERNAL KNOWLEDGE (Theories/Facts):
${externalContext || 'None'}
${imageContext}${foreshadowContext}

User Question: ${query}

Answer:`;

    const model = getModel();
    const temperature = effectiveMode === 'theory' ? undefined : 0;
    const result = await model.generateContent(prompt, { temperature });
    let answer = result.response.text();

    // Foreshadowing backstop (plan §2.14.4): the payoff never entered the prompt, but as a defense
    // against the model reconstructing it from training data, check the answer against the live
    // payoff summaries and fail closed if it leaks.
    if (effectiveMode === 'foreshadowing' && storyId && foreshadowContext) {
      try {
        const payoffs = await getLivePayoffSummaries(storyId, boundary ?? 0);
        if (payoffs.length > 0 && await checkPayoffLeak(answer, payoffs)) {
          answer =
            "I can point to a few details worth keeping in mind, but I won't speculate about where they "
            + "lead — that would risk spoiling what's ahead. Look again at the highlighted setups above.";
        }
      } catch (err) {
        console.error('Foreshadowing answer guard failed (non-fatal):', err);
      }
    }

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
