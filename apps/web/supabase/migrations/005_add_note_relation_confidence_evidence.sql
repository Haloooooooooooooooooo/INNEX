-- Phase 3: add confidence/evidence metadata for note relations

ALTER TABLE note_relations
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_nr_confidence ON note_relations(confidence);

