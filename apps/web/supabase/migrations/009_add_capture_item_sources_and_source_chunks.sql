-- Phase 2 foundation: source-aware raw assets and source retrieval chunks

CREATE TABLE IF NOT EXISTS capture_item_sources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_item_id  UUID NOT NULL REFERENCES capture_items(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL,
  source_label     TEXT,
  source_ref       TEXT,
  source_url       TEXT,
  content          TEXT NOT NULL,
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
  parse_status     TEXT NOT NULL DEFAULT 'success',
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE capture_item_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own capture item sources"
  ON capture_item_sources FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own capture item sources"
  ON capture_item_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own capture item sources"
  ON capture_item_sources FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own capture item sources"
  ON capture_item_sources FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cis_capture_item_id ON capture_item_sources(capture_item_id);
CREATE INDEX IF NOT EXISTS idx_cis_user_id ON capture_item_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_cis_type ON capture_item_sources(source_type);

CREATE TABLE IF NOT EXISTS source_chunks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_item_source_id  UUID NOT NULL REFERENCES capture_item_sources(id) ON DELETE CASCADE,
  capture_item_id         UUID NOT NULL REFERENCES capture_items(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index             INT NOT NULL,
  content                 TEXT NOT NULL,
  embedding               vector(1536),
  token_count             INT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capture_item_source_id, chunk_index)
);

ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own source chunks"
  ON source_chunks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own source chunks"
  ON source_chunks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own source chunks"
  ON source_chunks FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sc_capture_item_id ON source_chunks(capture_item_id);
CREATE INDEX IF NOT EXISTS idx_sc_source_id ON source_chunks(capture_item_source_id);
CREATE INDEX IF NOT EXISTS idx_sc_user_id ON source_chunks(user_id);

CREATE OR REPLACE FUNCTION match_source_chunks(
  query_embedding vector(1536),
  p_user_id uuid,
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 8
)
RETURNS TABLE(
  id uuid,
  capture_item_source_id uuid,
  capture_item_id uuid,
  chunk_index int,
  content text,
  source_type text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id,
    sc.capture_item_source_id,
    sc.capture_item_id,
    sc.chunk_index,
    sc.content,
    cis.source_type,
    1 - (sc.embedding <=> query_embedding) AS similarity
  FROM source_chunks sc
  JOIN capture_item_sources cis ON cis.id = sc.capture_item_source_id
  WHERE sc.user_id = p_user_id
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_source_chunks_in_capture_items(
  query_embedding vector(1536),
  p_user_id uuid,
  p_capture_item_ids uuid[],
  match_threshold float DEFAULT 0.6,
  match_count int DEFAULT 12
)
RETURNS TABLE(
  id uuid,
  capture_item_source_id uuid,
  capture_item_id uuid,
  chunk_index int,
  content text,
  source_type text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id,
    sc.capture_item_source_id,
    sc.capture_item_id,
    sc.chunk_index,
    sc.content,
    cis.source_type,
    1 - (sc.embedding <=> query_embedding) AS similarity
  FROM source_chunks sc
  JOIN capture_item_sources cis ON cis.id = sc.capture_item_source_id
  WHERE sc.user_id = p_user_id
    AND sc.capture_item_id = ANY(p_capture_item_ids)
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
