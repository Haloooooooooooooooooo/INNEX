-- Phase 1.x: notebook field for inbox drawer auto-save
ALTER TABLE capture_items
ADD COLUMN IF NOT EXISTS notebook TEXT;

