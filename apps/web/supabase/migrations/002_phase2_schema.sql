-- Phase 2: notes + note_relations + ai_answers + note_chunks + pgvector

CREATE EXTENSION IF NOT EXISTS vector;

-- Notes: structured markdown from internalization
CREATE TABLE notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capture_item_id  UUID REFERENCES capture_items(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  summary          TEXT,
  concepts         TEXT[] DEFAULT '{}',
  tags             TEXT[] DEFAULT '{}',
  source           TEXT,
  source_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notes"    ON notes FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notes"  ON notes FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notes"  ON notes FOR UPDATE  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own notes"  ON notes FOR DELETE  USING (auth.uid() = user_id);

CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_created_at ON notes(created_at DESC);

-- Note relations: links between notes
CREATE TABLE note_relations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_note_id   UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id   UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relation_type    TEXT NOT NULL DEFAULT 'related',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT different_notes CHECK (source_note_id <> target_note_id)
);

ALTER TABLE note_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own relations"   ON note_relations FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own relations" ON note_relations FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own relations" ON note_relations FOR DELETE  USING (auth.uid() = user_id);

CREATE INDEX idx_nr_source_note ON note_relations(source_note_id);
CREATE INDEX idx_nr_target_note ON note_relations(target_note_id);

-- AI answers: QA pairs saved to notes
CREATE TABLE ai_answers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id          UUID REFERENCES notes(id) ON DELETE CASCADE,
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL,
  citations        JSONB DEFAULT '[]',
  saved_to_note    BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own answers"   ON ai_answers FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own answers" ON ai_answers FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own answers" ON ai_answers FOR DELETE  USING (auth.uid() = user_id);

-- Note chunks: for RAG embeddings
CREATE TABLE note_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id          UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  chunk_index      INT NOT NULL,
  content          TEXT NOT NULL,
  embedding        vector(1536),
  token_count      INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(note_id, chunk_index)
);

ALTER TABLE note_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chunks"   ON note_chunks FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chunks" ON note_chunks FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own chunks" ON note_chunks FOR DELETE  USING (auth.uid() = user_id);

-- RPC: pgvector similarity search
CREATE OR REPLACE FUNCTION match_note_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  p_user_id uuid
)
RETURNS TABLE(
  id uuid,
  note_id uuid,
  chunk_index int,
  content text,
  note_title text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.id,
    nc.note_id,
    nc.chunk_index,
    nc.content,
    n.title AS note_title,
    1 - (nc.embedding <=> query_embedding) AS similarity
  FROM note_chunks nc
  JOIN notes n ON n.id = nc.note_id
  WHERE nc.user_id = p_user_id
    AND 1 - (nc.embedding <=> query_embedding) > match_threshold
  ORDER BY nc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
