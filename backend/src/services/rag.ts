/**
 * RAG (Retrieval-Augmented Generation) service.
 * Combines semantic search with LLM generation to answer questions about stories.
 * Supports multiple chat modes: recall, foreshadowing, and theory.
 */

import { getModel, generateEmbedding } from './llm';
import { logger } from './logger';
import { rewriteQuery, type ChatTurn, type QueryIntent } from './rewrite';
import { reciprocalRankFusion, applyFloor } from './fusion';
import { buildStoryContext } from './contextBuilder';
import { MAIN_MODEL } from '../config/models';
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
import { saveRagTrace } from './db';
import { randomUUID } from 'crypto';

interface ParsedAnswer {
  answer: string;
  citations: string[];
  confidence: Confidence;
  insufficientContext: boolean;
}

/**
 * Parse the model's structured answer JSON. Degrades gracefully: if the output isn't the expected
 * JSON (older prompts, mocked plain-text responses), the whole text becomes the answer with no
 * citations and medium confidence, so callers never lose the answer.
 */
const parseStructuredAnswer = (raw: string): ParsedAnswer => {
  let t = (raw || '').trim();
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n');
    t = nl >= 0 ? t.slice(nl + 1) : t.slice(3);
    if (t.endsWith('```')) t = t.slice(0, -3);
    t = t.trim();
  }
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o && typeof o.answer === 'string') {
      const conf = o.confidence;
      return {
        answer: o.answer,
        citations: Array.isArray(o.citations) ? o.citations.map(String) : [],
        confidence: conf === 'high' || conf === 'low' ? conf : 'medium',
        insufficientContext: Boolean(o.insufficient_context),
      };
    }
  } catch {
    // not JSON — fall through to plain-text treatment
  }
  return { answer: (raw || '').trim(), citations: [], confidence: 'medium', insufficientContext: false };
};

export type ChatMode = 'recall' | 'foreshadowing' | 'theory';

export type Confidence = 'high' | 'medium' | 'low';

export interface ChatSource {
  chapterOrder: number;
  blockId: string;
  title: string;
  snippet?: string;
  sourceType?: 'block' | 'graph' | 'external';
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
  confidence: Confidence;
  insufficientContext: boolean;
  traceId: string;
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
  userId: string = DEFAULT_USER_ID,
  history: ChatTurn[] = []
): Promise<ChatResponse> => {
  const traceId = randomUUID();
  try {
    // Resolve the spoiler boundary server-side when a story is scoped (default-deny: an omitted
    // currentChapter falls back to reading_progress, then 0 — never "everything"). priorVolumeIds
    // come from resolveSpoilerScope, ordered by volume_number (not the old lexicographic title sort).
    const scope = storyId ? await resolveSpoilerScope(storyId, currentChapter, userId) : null;
    const boundary = scope ? scope.maxChapterOrder : currentChapter;
    const priorVolumeIds = scope && scope.priorVolumeIds.length > 0 ? scope.priorVolumeIds : undefined;

    // M10: one Flash-Lite call resolves follow-ups (history → standalone query), classifies intent,
    // and extracts entity mentions — replacing the brittle substring intent hacks. An explicit
    // non-recall UI mode always wins over the model's guess. Fail-open: on failure this is the raw
    // query + 'recall' (spoiler safety is enforced downstream in SQL regardless).
    const explicitIntent: QueryIntent | undefined = mode !== 'recall' ? mode : undefined;
    const plan = await rewriteQuery(query, history, explicitIntent);
    const searchQuery = plan.standaloneQuery;

    // Handle summary queries using the summarization pipeline
    if (plan.intent === 'summary' && storyId) {
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
        confidence: 'high',
        insufficientContext: false,
        traceId,
      };
    }

    // Intent from the rewrite (explicit mode already folded in); 'summary' handled above.
    const effectiveMode: ChatMode = (plan.intent === 'summary' ? 'recall' : plan.intent);

    // Step 1: Embed the standalone query (gemini-embedding-2 uses the in-prompt query instruction).
    const embedding = await generateEmbedding(searchQuery, 'query');

    // Step 1.7: GraphRAG — link the query to known entities (spoiler-visible aliases only), expand
    // the keyword arm with those aliases ("Dead End" also retrieves "Ruijerd" passages), and build a
    // KNOWLEDGE GRAPH context block. No-op when the story has no graph. Non-fatal.
    let graphContext = '';
    // Keyword arm starts from the standalone query + the rewrite's entity mentions, then is widened
    // with spoiler-visible graph aliases below.
    let keywordQuery = [searchQuery, ...plan.entityMentions].join(' ');
    if (storyId) {
      try {
        const linked = await linkEntities(searchQuery, storyId, boundary ?? 0);
        if (linked.length > 0) {
          const aliasTerms = [...new Set(linked.flatMap((e) => [e.name, ...e.aliases]))];
          keywordQuery = `${keywordQuery} ${aliasTerms.join(' ')}`;
          const ego = await getEgoNetwork(linked.map((e) => e.entityId), storyId, boundary ?? 0);
          graphContext = formatGraphContext(linked, ego);
        }
      } catch (err) {
        logger.error({ err }, 'Graph linking failed (non-fatal)');
      }
    }

    // Step 2: Hybrid search — semantic + keyword, cross-volume aware (resolved boundary + prior volumes)
    const [semanticBlocks, keywordBlocks] = await Promise.all([
      findSimilarBlocks(embedding, storyId, boundary, 5, priorVolumeIds),
      findBlocksByKeyword(keywordQuery, storyId, boundary, 5, priorVolumeIds),
    ]);

    // M10: fuse the semantic + keyword arms by RANK (RRF) instead of the old `*0.3` score fudge —
    // cosine and keyword scores aren't on the same scale, so rank fusion is more principled. A
    // configurable similarity floor (default 0 = off) first drops near-noise semantic hits.
    const simFloor = Number(process.env.RAG_SIM_FLOOR || 0);
    const flooredSemantic = simFloor > 0 ? applyFloor(semanticBlocks, (b) => b.similarity, simFloor) : semanticBlocks;
    const mergedBlocks = reciprocalRankFusion(
      [flooredSemantic, keywordBlocks],
      (b) => b.block_id,
    )
      .slice(0, 8)
      .map((f) => f.item);

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
      const knownFacts = await findSimilarExternalKnowledge(embedding, storyId, boundary ?? 0);
      if (knownFacts.length > 0) {
        externalContext += '\n\nExisting Knowledge:\n' + knownFacts.map(k => `- ${k.content}`).join('\n');
      }
    }

    // Step 5: Format Context (M10) — budgeted, labeled [S1]..[Sn] assembly. `contextBlocks` is what
    // actually fit the budget (in label order); citations + sources are built from it, not from the
    // full merged set, so a dropped block can't be cited.
    const { context: storyContext, used: contextBlocks } = buildStoryContext(
      mergedBlocks,
      { maxChars: Number(process.env.RAG_CONTEXT_BUDGET || 8000) },
    );

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
        logger.error({ err }, 'Foreshadowing seed lookup failed (non-fatal)');
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

Respond as STRICT JSON (no markdown fences):
{"answer": "<your answer in prose>",
 "citations": ["S1", "S3", ...],   // the [S#] labels you actually used from STORY CONTEXT
 "confidence": "high|medium|low",   // how well the context supports the answer
 "insufficient_context": true|false} // true if the read chapters don't contain the answer`;

    const model = getModel();
    const temperature = effectiveMode === 'theory' ? undefined : 0;
    const result = await model.generateContent(prompt, { temperature, usageContext: `chat:${effectiveMode}`, storyId });
    const rawOutput = result.response.text();

    // Parse structured output; degrade gracefully to plain text if the model didn't return JSON.
    const parsed = parseStructuredAnswer(rawOutput);
    let answer = parsed.answer;
    const confidence: Confidence = parsed.confidence;
    const insufficientContext = parsed.insufficientContext;

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
        logger.error({ err }, 'Foreshadowing answer guard failed (non-fatal)');
      }
    }

    // Build sources. Prefer cited-only (labels validated against the retrieved set — hallucinated
    // labels dropped). If the model returned no valid citations (or didn't produce JSON), fall back
    // to the retrieved blocks so we never return an answer with zero provenance.
    // Citations index into the LABELED context ([S1]..[Sn]), which is `contextBlocks` (what fit the
    // budget) — not the full merged set — so a dropped block can never be cited.
    const citedIdx = parsed.citations
      .map(label => parseInt(label.replace(/[^0-9]/g, ''), 10) - 1)
      .filter(i => Number.isInteger(i) && i >= 0 && i < contextBlocks.length);
    const chosen = citedIdx.length > 0 ? [...new Set(citedIdx)].map(i => contextBlocks[i]) : contextBlocks;
    const sources: ChatSource[] = chosen.map(b => ({
      chapterOrder: b.chapter_order,
      blockId: b.block_id,
      title: b.title,
      snippet: (b.text_content || '').trim().slice(0, 200),
      sourceType: 'block' as const,
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

    // Fire-and-forget trace for debugging + the eval retrieval suite (never blocks the response).
    void saveRagTrace({
      traceId, storyId: storyId ?? null, mode: effectiveMode, boundaryChapter: boundary ?? null,
      query, answer, confidence, sourceCount: sources.length, insufficientContext,
    }).catch(err => logger.error({ err }, 'saveRagTrace failed (non-fatal)'));

    return { answer, sources, images, confidence, insufficientContext, traceId };
  } catch (error) {
    // Hard pipeline failure: log and rethrow so the controller returns 502 (monitoring-visible),
    // instead of masking an outage as a 200 "apology". Insufficient-context is NOT an error — that
    // is a normal 200 with insufficientContext=true handled above.
    logger.error({ err: error, traceId }, 'Error in RAG answerQuery');
    throw error;
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
  const modelName = MAIN_MODEL;

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
      `No chapter-by-chapter breakdown. Do NOT include events beyond Chapter ${upToChapter}.\n\n${allText}`,
      { usageContext: 'summary', storyId },
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
          `Summarize these chapters in 2-3 sentences covering only the main events:\n\n${chunk}`,
          { usageContext: 'summary', storyId },
        );
        chunkSummaries.push(res.response.text());
        chunk = '';
      }
      chunk += entry;
    }
    if (chunk) {
      const res = await model.generateContent(
        `Summarize these chapters in 2-3 sentences covering only the main events:\n\n${chunk}`,
        { usageContext: 'summary', storyId },
      );
      chunkSummaries.push(res.response.text());
    }

    // Final summary of summaries
    const combined = chunkSummaries.map((s, i) => `Part ${i + 1}:\n${s}`).join('\n\n');
    const finalResult = await model.generateContent(
      `Combine into a single 3-5 sentence summary of this volume's main plot. ` +
      `No bullet points, no chapter references, just a flowing narrative:\n\n${combined}`,
      { usageContext: 'summary', storyId },
    );
    summary = finalResult.response.text();
  }

  // Cache the result
  await saveSummary(storyId, upToChapter, summary, modelName);

  return summary;
};
