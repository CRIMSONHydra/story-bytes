/**
 * Context assembly (M10, RAG D9). Turns the fused, ranked blocks into the labeled `[S1]..[Sn]` story
 * context the model cites, under a character budget so a few long chapters can't crowd out breadth.
 * Blocks are consumed best-first; once the budget is hit, the rest are dropped. The returned
 * `used` list (in label order) is what citation validation and the sources array are built from.
 */

export interface ContextBlock {
  block_id: string;
  chapter_order: number;
  block_index?: number;
  title: string;
  text_content: string;
  story_title?: string | null;
  similarity: number;
}

export interface BuiltContext {
  context: string;
  used: ContextBlock[];
}

const DEFAULT_BUDGET = 8000;

const label = (block: ContextBlock, i: number): string => {
  const volumePrefix = block.story_title ? `${block.story_title}, ` : '';
  return `[S${i + 1}] [${volumePrefix}Chapter ${block.chapter_order}: ${block.title}]\n${block.text_content}`;
};

/**
 * Assemble labeled context within `maxChars`. Always includes at least the top block (even if it
 * alone exceeds the budget) so a single long, highly-relevant block is never silently dropped.
 */
export const buildStoryContext = (
  blocks: ContextBlock[],
  options: { maxChars?: number } = {},
): BuiltContext => {
  const maxChars = options.maxChars ?? DEFAULT_BUDGET;
  const used: ContextBlock[] = [];
  let total = 0;

  for (const block of blocks) {
    const piece = block.text_content ?? '';
    if (used.length > 0 && total + piece.length > maxChars) break;
    used.push(block);
    total += piece.length;
  }

  return { context: used.map(label).join('\n\n'), used };
};
