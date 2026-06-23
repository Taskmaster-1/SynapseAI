-- ════════════════════════════════════════════════════════
--  SynapseAI – RAG Setup (Vector Search)
--  Run in Supabase SQL Editor
-- ════════════════════════════════════════════════════════

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create file_chunks table
CREATE TABLE IF NOT EXISTS file_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id     UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    embedding   VECTOR(768), -- for Google Gemini text-embedding-004
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE file_chunks ENABLE ROW LEVEL SECURITY;

-- 4. Create policies
CREATE POLICY "file_chunks: owner access" ON file_chunks
    FOR ALL USING (auth.uid() = user_id);

-- 5. Create vector similarity search function (RPC)
CREATE OR REPLACE FUNCTION match_file_chunks (
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT,
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    file_chunks.id,
    file_chunks.content,
    file_chunks.metadata,
    1 - (file_chunks.embedding <=> query_embedding) AS similarity
  FROM file_chunks
  WHERE file_chunks.user_id = p_user_id
    AND 1 - (file_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY file_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 6. Create index for performance
CREATE INDEX ON file_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
