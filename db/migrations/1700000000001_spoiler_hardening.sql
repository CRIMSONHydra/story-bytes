-- Up Migration
-- M8 spoiler-critical schema (plan §2.10): explicit volume ordering, asset anchoring,
-- and the chapter uniqueness invariant that all spoiler math assumes.

-- Explicit volume order (replaces fragile ORDER BY title, which breaks at Vol. 10 vs Vol. 2).
ALTER TABLE stories ADD COLUMN IF NOT EXISTS volume_number INT;
UPDATE stories
  SET volume_number = NULLIF((regexp_match(title, '(?:vol(?:ume)?\.?\s*)(\d+)', 'i'))[1], '')::int
  WHERE volume_number IS NULL;

-- Anchor every asset to the earliest chapter that references it; NULL (unanchored) = spoiler-blocked
-- unless it is a cover belonging to a fully-read prior volume.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS first_chapter_order INT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_cover BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE assets a SET first_chapter_order = sub.min_order
  FROM (
    SELECT a2.asset_id, MIN(c.chapter_order) AS min_order
    FROM assets a2
    JOIN chapter_blocks cb ON cb.image_src = a2.href
    JOIN chapters c ON c.chapter_id = cb.chapter_id AND c.story_id = a2.story_id
    GROUP BY a2.asset_id
  ) sub
  WHERE a.asset_id = sub.asset_id AND a.first_chapter_order IS NULL;
UPDATE assets SET is_cover = TRUE WHERE href ~* '(^|/)cover' AND first_chapter_order IS NULL;

-- The uniqueness invariant spoiler ordering depends on. Idempotent; created only if the data is clean.
-- (If duplicates exist, this raises — surface them for manual resolution rather than auto-deleting.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chapters_story_order ON chapters (story_id, chapter_order);

-- Down Migration
DROP INDEX IF EXISTS uq_chapters_story_order;
ALTER TABLE assets DROP COLUMN IF EXISTS is_cover;
ALTER TABLE assets DROP COLUMN IF EXISTS first_chapter_order;
ALTER TABLE stories DROP COLUMN IF EXISTS volume_number;
