/**
 * Image prompt builder (M17) — PURE and spoiler-safety-structural. The prompt is assembled ONLY from
 * an entity's canon (appearance facts already sliced ≤ the reader's boundary by `buildCanon`) plus
 * the entity type. It deliberately excludes:
 *   - the entity's name / aliases (a name can be a reveal not yet known at this boundary),
 *   - the free-text `kg_entities.description` (not chapter-bounded — could carry future traits).
 * So by construction a post-boundary trait can never reach the image model. Golden tests assert this.
 */

import type { Canon } from './canon';

/** Build the generation prompt from an entity's canon. Empty canon → a deliberately generic prompt. */
export const buildImagePrompt = (entityType: string, canon: Canon): string => {
  const subject = entityType === 'character' ? 'a person' : `a ${entityType}`;
  const traits = canon.facts.map((f) => `${f.factType}: ${f.value}`).join('; ');
  const traitClause = traits ? ` Appearance — ${traits}.` : '';
  return (
    `Character portrait illustration of ${subject}.${traitClause} ` +
    `Style: detailed digital character art, head-and-shoulders, neutral plain background, no text, ` +
    `no watermark. Depict only the traits described above; invent nothing beyond them.`
  );
};
