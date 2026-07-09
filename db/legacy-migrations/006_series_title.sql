-- Add series_title column for cross-volume grouping
ALTER TABLE stories ADD COLUMN IF NOT EXISTS series_title TEXT;

-- Create index for fast series lookups
CREATE INDEX IF NOT EXISTS idx_stories_series_title ON stories (series_title);

-- Backfill: strip volume suffixes, normalize separators
UPDATE stories SET series_title =
  TRIM(BOTH FROM
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(title, '[-–—:\s]*(Volume|Vol\.?)\s*\d+.*$', '', 'i'),
        '\s*[-–—:]\s*$', ''
      ),
      '\s*[-–—]\s*', ': ', 'g'
    )
  )
WHERE series_title IS NULL;
