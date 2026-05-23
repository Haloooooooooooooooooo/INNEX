ALTER TABLE capture_items
ADD COLUMN IF NOT EXISTS parse_debug JSONB;

