-- Phase 4: scoped vector recall by candidate note ids

CREATE OR REPLACE FUNCTION match_note_chunks_in_notes(
  query_embedding vector(1536),
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

