/**
 * Text chunking (M13) — a TypeScript mirror of ingestion `split_into_chunks` (load_to_db.py) so
 * backend-side paste/append produces the same block granularity as file ingestion. Splits an
 * over-long text on paragraph boundaries into ~targetChars sub-chunks with a one-paragraph overlap;
 * text at or under maxChars is returned unchanged; a single over-long paragraph is kept whole.
 */

export const splitIntoChunks = (text: string, maxChars = 1600, targetChars = 1200): string[] => {
  if (!text || text.length <= maxChars) return [text];

  const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
  if (paras.length <= 1) return [text];

  const chunks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const p of paras) {
    if (cur.length > 0 && curLen + p.length > targetChars) {
      chunks.push(cur.join('\n\n'));
      cur = [cur[cur.length - 1]]; // 1-paragraph overlap into the next chunk
      curLen = cur[0].length;
    }
    cur.push(p);
    curLen += p.length;
  }
  if (cur.length > 0) chunks.push(cur.join('\n\n'));
  return chunks;
};
