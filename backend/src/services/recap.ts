/**
 * Recap composition (plan §2.12, §2.14) — the "catch me up to chapter N" surface.
 *
 * Composes existing spoiler-gated outputs into one view: the cumulative "story so far" summary,
 * the last few chapters, and (when a graph exists) the last event, main cast, open threads, and —
 * only when explicitly requested — the opt-in foreshadowing emphasis. Every piece is already bounded
 * by the resolved SpoilerScope; foreshadowing additionally shows only setup+hint for links whose
 * payoff is strictly ahead of the reader.
 */

import { pool } from '../db/pool';
import { summarizeStory } from './rag';
import {
  storyHasGraph,
  getLastEvent,
  getMainCast,
  getOpenThreads,
  getForeshadowLinks,
  type CastMember,
  type OpenThread,
  type LastEvent,
  type ForeshadowItem,
} from './graph';
import type { SpoilerScope } from './spoilerScope';

const FRONT_MATTER_PATTERNS = [
  'table of contents', 'copyright', 'credits', 'title page', 'newsletter', 'cover',
];

export interface RecentChapter {
  chapterOrder: number;
  title: string;
  summary: string;
}

export interface Recap {
  storyId: string;
  upToChapter: number;
  storySoFar: string;
  recentChapters: RecentChapter[];
  lastEvent: LastEvent | null;
  mainCast: CastMember[];
  openThreads: OpenThread[];
  foreshadowing: ForeshadowItem[] | null;
  meta: { hasGraph: boolean; foreshadowEnabled: boolean };
}

const isFrontMatter = (title: string | null): boolean => {
  const t = (title || '').toLowerCase();
  return FRONT_MATTER_PATTERNS.some((p) => t.includes(p));
};

/** A short excerpt of the last few read chapters (stopgap until M10 micro-summaries exist). */
const getRecentChapters = async (storyId: string, maxChapterOrder: number): Promise<RecentChapter[]> => {
  const result = await pool.query(
    `SELECT chapter_order, title, aggregated_text
     FROM chapters
     WHERE story_id = $1 AND chapter_order <= $2
     ORDER BY chapter_order DESC`,
    [storyId, maxChapterOrder],
  );
  const recent: RecentChapter[] = [];
  for (const row of result.rows) {
    if (isFrontMatter(row.title)) continue;
    const text = (row.aggregated_text || '').trim().replace(/\s+/g, ' ');
    recent.push({
      chapterOrder: row.chapter_order,
      title: row.title || `Chapter ${row.chapter_order}`,
      summary: text.length > 280 ? `${text.slice(0, 280)}…` : text,
    });
    if (recent.length >= 3) break;
  }
  return recent.reverse();
};

export const buildRecap = async (
  scope: SpoilerScope,
  includeForeshadow: boolean,
): Promise<Recap> => {
  const { storyId, maxChapterOrder } = scope;

  const [storySoFar, recentChapters, hasGraph] = await Promise.all([
    summarizeStory(storyId, maxChapterOrder).catch(() => ''),
    getRecentChapters(storyId, maxChapterOrder),
    storyHasGraph(storyId),
  ]);

  let lastEvent: LastEvent | null = null;
  let mainCast: CastMember[] = [];
  let openThreads: OpenThread[] = [];
  let foreshadowing: ForeshadowItem[] | null = null;

  if (hasGraph) {
    [lastEvent, mainCast, openThreads] = await Promise.all([
      getLastEvent(storyId, maxChapterOrder),
      getMainCast(storyId, maxChapterOrder),
      getOpenThreads(storyId, maxChapterOrder),
    ]);
    if (includeForeshadow) {
      foreshadowing = await getForeshadowLinks(storyId, maxChapterOrder);
    }
  }

  return {
    storyId,
    upToChapter: maxChapterOrder,
    storySoFar: storySoFar || '',
    recentChapters,
    lastEvent,
    mainCast,
    openThreads,
    foreshadowing,
    meta: { hasGraph, foreshadowEnabled: includeForeshadow },
  };
};
