-- 010: change embedding dimension 1536 -> 1024 to match BAAI/bge-m3.
-- Root cause: DB vectors were vector(1536) (designed for OpenAI text-embedding-3-small),
-- but the configured embedding model is bge-m3 (1024-dim). 1024-dim vectors were rejected
-- by pgvector on insert, so note_chunks.embedding stayed all NULL and vector recall
-- (graph relation building + QA match_note_chunks) silently returned 0 candidates.
-- Columns are currently all-NULL, so the type change is lossless. Re-embed after running.
-- No ivfflat/hnsw index exists on these columns, so no index rebuild is needed.

-- 1) Columns -> vector(1024)
ALTER TABLE note_chunks   ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE source_chunks ALTER COLUMN embedding TYPE vector(1024);

-- 2) Recreate RPCs with vector(1024) signature (bodies unchanged).
CREATE OR REPLACE FUNCTION match_note_chunks(
  query_embedding vector(1024),
  p_user_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
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

-- __APPEND_RPC_2__
CREATE OR REPLACE FUNCTION match_note_chunks_in_notes(
  query_embedding vector(1024),
  p_user_id uuid,
  p_note_ids uuid[],
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 8
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
    AND nc.note_id = ANY(p_note_ids)
    AND 1 - (nc.embedding <=> query_embedding) > match_threshold
  ORDER BY nc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- __APPEND_RPC_3__
CREATE OR REPLACE FUNCTION match_source_chunks(
  query_embedding vector(1024),
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

-- __APPEND_RPC_4__
CREATE OR REPLACE FUNCTION match_source_chunks_in_capture_items(
  query_embedding vector(1024),
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

-- 3) Refresh PostgREST schema cache so the new signatures are picked up.
NOTIFY pgrst, 'reload schema';



