-- Store the source EPUB file path for direct image serving
ALTER TABLE stories ADD COLUMN IF NOT EXISTS epub_path TEXT;
